---
title: Validation
order: 8
description: Validate request input with FormValidator and the built-in Rules, write your own rule, and show errors and the old input back in a form.
---

# Validation

Check the input before you trust it.

A `FormValidator` holds a list of rules per field. You give it an array of input, it gives you back an `ErrorBag`. Nothing is read from the request for you, and nothing is thrown unless you ask for it.

## Validate input

```php
use Zephyrus\Validation\FormValidator;
use Zephyrus\Validation\Rules;

$form = new FormValidator([
    'email' => [Rules::required(), Rules::email()],
    'age' => [Rules::integer(), Rules::between(18, 120)],
]);

$errors = $form->validate($request->body()->all());

if ($errors->hasErrors()) {
    return $this->json(['errors' => $errors->toArray()], 422);
}
```

`$request->body()->all()` is the decoded form or JSON body (see [HTTP](../http/)). With the input `['email' => 'nope', 'age' => '12']`, `$errors->toArray()` is:

```json
{
    "email": ["Must be a valid email address."],
    "age": ["Must be between 18 and 120."]
}
```

The rules of a field run in the order you list them, and every failing rule adds its message: a field never stops at its first failure. A missing `email` with the rules above reports both `This field is required.` and `Must be a valid email address.`. Put `Rules::required()` first and show only the first message of a field if you prefer a single line (see [Show errors in a form](#show-errors-in-a-form)).

### Optional fields

A field **without** a `required()` rule is skipped when its value is `null` or an empty string. That is what makes `age` above optional: an empty `age` passes, a filled one must be an integer between 18 and 120.

A field **with** `required()` runs all its rules on empty values too. `required()` refuses `null`, `''` and `[]`, and accepts `'0'`, `0` and `false`. It also accepts `'   '` (spaces only): add `Rules::notBlank()` when whitespace must not count as an answer.

### Nested fields

A field name with a dot reads into nested arrays: `address.city` looks at `$data['address']['city']`. A missing key at any depth is `null`, so `required()` reports it.

```php
$address = new FormValidator([
    'city' => [Rules::required()],
    'postal' => [Rules::postalCode()],
]);

$form = (new FormValidator(['name' => [Rules::required()]]))
    ->withNested('address', $address);
```

`withNested('address', $address)` merges the other validator's fields under the prefix: `city` becomes `address.city`.

### Build a validator step by step

A `FormValidator` is immutable. `withField($name, $rules)` and `withFields($fields)` return a copy with the fields added or replaced, and `fields()` returns the current rules. Keep the returned value:

```php
$form = $form
    ->withField('email', [Rules::required(), Rules::email()])
    ->withFields(['age' => [Rules::integer()]]);
```

### Throw instead of checking

`validateOrFail()` returns the (empty) `ErrorBag` when everything passes and throws a `ValidationException` otherwise:

```php
$form->validateOrFail($request->body()->all());
```

The exception carries the bag, and the application turns it into a 422 answer. That answer is `{"errors":{...}}` when the request's `Accept` header lists JSON. Anything else, a browser or a `fetch()` call without that header, gets the plain text `Unprocessable Entity`. An HTML form should therefore use `validate()` and render the form again. Reserve `validateOrFail()` for API routes:

```php
use Zephyrus\Validation\ValidationException;

try {
    $form->validateOrFail($input);
} catch (ValidationException $e) {
    $errors = $e->errors(); // the ErrorBag
}
```

The exception message is `Validation failed.`; it is not sent to the client. `ValidationException::fromErrorBag($bag, $message)` builds one from a bag you filled yourself.

## The error bag

`ErrorBag` is what `validate()` returns. You can also create one (`new ErrorBag()`) to add errors of your own:

| Method | Returns |
|---|---|
| `hasErrors()` | `true` when any field failed. |
| `hasErrorsFor($field)` | `true` when that field failed. |
| `errorsFor($field)` | The messages of one field, `[]` when it passed. |
| `firstFor($field)` | The first message of one field, or `null`. |
| `failingFields()` | The names of the fields that failed. |
| `allMessages()` | Every message in one flat list. |
| `toArray()` | `field => list of messages`. |
| `add($field, $message)` | Adds one message. |
| `merge($other)` | Adds every message of another bag. |

`merge()` and `add()` are for errors that come from somewhere other than a rule, for example a username that is already taken, which only your database can tell:

```php
$errors = $form->validate($input);
if ($usernames->exists($input['username'])) {
    $errors->add('username', 'This username is taken.');
}
```

## Show errors in a form

Render the form again with status 422, passing the input and the bag back to the view (see [Views](../views/)):

```php
#[Post('/contact')]
public function submit(Request $request): Response
{
    $input = $request->body()->all();
    $errors = self::validator()->validate($input);

    if ($errors->hasErrors()) {
        return $this->render('contact', ['old' => $input, 'errors' => $errors], 422);
    }

    Flash::success('Thanks, we will reply soon.');
    return Response::redirect('/contact');
}
```

The first display of the form passes empty values: `['old' => [], 'errors' => new ErrorBag()]`. In the template, Latte escapes every value, including the old input echoed back into an attribute:

```latte
<form method="post" action="{route('contact')}">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">

    <label>Name
        <input name="name" value="{$old['name'] ?? ''}"{if $errors->hasErrorsFor('name')} aria-invalid="true"{/if}>
    </label>
    {if $errors->hasErrorsFor('name')}<p class="error">{$errors->firstFor('name')}</p>{/if}

    <label>Email
        <input type="email" name="email" value="{$old['email'] ?? ''}">
    </label>
    {foreach $errors->errorsFor('email') as $message}<p class="error">{$message}</p>{/foreach}

    <button>Send</button>
</form>
```

With the name `   ` and the email `bad"<x>`, the page showed `value="bad&quot;&lt;x&gt;"` and `Must be a valid email address.` under the field. The hidden `_csrf_token` field is required on every form that posts (see [Security](../security/)).

Do not echo a password back: leave it out of `old`. The flash message in the example is described on [Sessions](../sessions/).

## Rules

Every rule is a static method of `Rules` that returns a `Rule`. Almost all take an optional last argument, the error message, with an English default. A custom message replaces the default for that rule:

```php
Rules::minLength(8, 'The password needs at least 8 characters.')
```

Messages are plain strings and are not translated for you. To translate them, pass the result of `localize()` (see [Localization](../localization/)).

A rule never throws on a value of the wrong type: it fails. `minLength()` on an integer fails, `integer()` on `true` fails. The checks below are exact, so read the notes before relying on an edge case.

### Presence and type

| Rule | Accepts |
|---|---|
| `required()` | Anything but `null`, `''` and `[]`. Makes the field mandatory. |
| `notBlank()` | A string with at least one non-whitespace character. |
| `nonEmptyString()` | The same check as `notBlank()`. |
| `boolean()` | `true`, `false`, `1`, `0`, `'1'`, `'0'`, `'true'`, `'false'` (any case). |
| `integer()` | An int, an integer string (`'5'`, `'+5'`) or a whole float. Not `true`, `5.5`, `'05'` or `'5.0'`. |
| `numeric()` | An int, a float or a numeric string (PHP's `is_numeric`). |
| `integerString()` | A string of an optional minus sign and digits. |
| `decimalString($scale = 2)` | A string with an optional minus sign and at most `$scale` decimals. |
| `in($allowed)` | A value strictly equal to one of `$allowed`. |
| `inCaseInsensitive($values)` | A string equal to one of `$values`, ignoring case. |

### Length, size and count

| Rule | Accepts |
|---|---|
| `minLength($min)`, `maxLength($max)` | A string of at least or at most that many characters (multibyte-aware). |
| `min($min)`, `max($max)` | A number at least or at most the bound. |
| `greaterThan($min)`, `lessThan($max)` | A number strictly above or below the bound. |
| `between($min, $max)` | A number within the bounds, inclusive. |
| `betweenExclusive($min, $max)` | A number strictly within the bounds. |
| `countMin($min)`, `countMax($max)` | An array with at least or at most that many items. |

### Text and patterns

| Rule | Accepts |
|---|---|
| `regex($pattern, $message)` | A string matching a full PCRE pattern. The message is required. |
| `ascii()` | A string of ASCII bytes only. |
| `alphaNumeric()` | A non-empty string of ASCII letters and digits. |
| `startsWith($prefix)`, `endsWith($suffix)`, `contains($needle)` | A string with that prefix, suffix or content (byte-wise, case-sensitive). |
| `lowercase()`, `uppercase()` | A string unchanged by lower-casing or upper-casing it. |
| `noWhitespace()` | A non-empty string without whitespace. |
| `slug()` | Lowercase letters and digits joined by single hyphens. |
| `base64()`, `base64Url()` | Canonical Base64, or unpadded Base64URL. |
| `json()`, `jsonObject()`, `jsonArray()` | JSON text, a JSON object, a JSON array. |
| `jsonPointer()` | An RFC 6901 JSON pointer. |

`regex()` takes a pattern with delimiters. End it with `\z` or add the `D` modifier: a bare `$` also matches before a final newline, and `/^[A-Z]{2}\d{3}$/` would accept `"AB123\n"`.

### Web and network

| Rule | Accepts |
|---|---|
| `email()` | What PHP's `FILTER_VALIDATE_EMAIL` accepts. |
| `url()` | A URL with any scheme (`ftp://example.com` passes). |
| `httpUrl()` | An absolute URL with the scheme `http` or `https`. Use this one for links you will display or follow. |
| `hostname()`, `host()`, `hostPort()` | A DNS name, a name or an IP address, or `host:port` (IPv6 in brackets). |
| `ip()`, `ipv4()`, `ipv6()` | An IP address. CIDR notation is refused. |
| `privateIp()`, `publicIp()` | An address in a private or reserved range, or outside them. |
| `cidr()`, `subnetMask()` | A CIDR block (`10.0.0.0/8`, no host bits set), or an IPv4 mask. |
| `port()`, `portRange()` | A port from 1 to 65535, or `start-end`. |
| `macAddress()` | Six hex pairs separated by `:` or `-`. |
| `httpPath()`, `pathSegment()`, `queryString()`, `percentEncoded()` | Parts of a URL. |

### Dates and times

| Rule | Accepts |
|---|---|
| `date($format = 'Y-m-d')` | A string that round-trips through the format: `2026-02-30` is refused. |
| `dateTime($format = 'Y-m-d H:i:s')` | The same, for a date and time. |
| `rfc3339DateTime()` | A whole-second RFC 3339 date-time with `Z` or an offset. |
| `time24()` | `HH:MM` from `00:00` to `23:59`. |
| `timezone()` | An identifier from `DateTimeZone::listIdentifiers()`. Aliases such as `America/Montreal` are refused. |
| `unixTimestamp()`, `epochMilliseconds()` | A non-negative whole number of seconds or milliseconds. |
| `cronExpression()` | Five fields separated by spaces. The field values are not range-checked. |

### Identifiers and codes

| Rule | Accepts |
|---|---|
| `uuid()`, `uuidV1toV5()`, `uuidV4()`, `uuidV6()`, `uuidV7()`, `uuidV8()` | A UUID of any shape, or of the stated version. |
| `ulid()`, `sha256()`, `semver()` | A ULID, a 64-character lowercase hex hash, a version such as `1.4.0` (no leading `v`). |
| `phoneE164()` | `+` then 2 to 15 digits, the first one not zero. |
| `postalCode()` | 3 to 13 letters, digits, spaces or hyphens. The shape only, not a country's format. |
| `hexColor()` | `#RGB` or `#RRGGBB`. |
| `countryCode()`, `currencyCode()`, `locale()`, `languageTag()` | The shape of a country code, a currency code, `en_CA`, a BCP-47 tag. The values are not checked against a registry. |
| `latitude()`, `longitude()` | A number from -90 to 90, or from -180 to 180. |
| `iban()`, `bic()` | The shape of an IBAN or a BIC. No checksum and no bank registry. |
| `cardNumber()`, `cardNumberLuhn()`, `cardCvv()` | 12 to 19 digits (with or without the Luhn checksum), or a 3 or 4 digit code. |
| `cardExpiryMmyy()`, `cardExpiryMmyyyy()` | `MM/YY` or `MM/YYYY`. The date is not compared with today. |

### Files and names

| Rule | Accepts |
|---|---|
| `safeFilename()` | Up to 255 letters, digits, `.`, `_` or `-`, starting with a letter or digit, with no `..`. |
| `fileExtension()` | 1 to 10 ASCII letters or digits, without the dot. |
| `mimeType()` | A `type/subtype` token. Parameters such as `; charset=` are refused. |

A client's file name is never a safe name on its own: see [Uploads](../../digging-deeper/uploads/) for storing files.

### HTTP protocol values

For APIs that take headers or protocol values as data: `httpStatusCode()` (100 to 599), `httpMethod()`, `httpVersion()`, `bearerToken()`, `jwt()` (the token's format, not its signature), `acceptLanguage()`, `httpHeaderName()`, `httpHeaderValue()`, `etag()`, `ifMatch()`, `ifNoneMatch()`, `httpDate()`, `ifModifiedSince()`, `ifUnmodifiedSince()`, `ifRange()`, `byteRange()` and `contentRange()`.

## Your own rule

`Rule::of()` takes a closure that returns `true` when the value is valid, and the message to report:

```php
use Zephyrus\Validation\Rule;

$form = new FormValidator([
    'code' => [Rule::of(fn (mixed $value): bool => $value === 'ok', 'Wrong code.')],
]);
```

The closure receives the field's value, whatever its type: check it before you use it. To compare a field with another one, close over the input:

```php
$input = $request->body()->all();

$form = new FormValidator([
    'confirm' => [Rule::of(fn (#[\SensitiveParameter] mixed $value): bool => $value === ($input['password'] ?? null), 'Does not match.')],
]);
```

The framework hides the value under validation from a stack trace (`#[\SensitiveParameter]` on `Rule::test()`, `FormValidator::validate()` and every rule of `Rules`), so an exception thrown during a validation does not keep a password in `getTrace()`. The closure you give to `Rule::of()` is yours to mark: when it receives a secret, put `#[\SensitiveParameter]` on its parameter, as above, or its own frame of the trace still holds the value.

The optional third argument is a tag. Only the tag `required` has a meaning for the validator (it is what `Rules::required()` carries). A rule is also callable by hand: `$rule->test($value)` returns the verdict, `$rule->errorMessage()` the message and `$rule->tag()` the tag.

## Good to know

- **Every failing rule reports.** A missing `name` with `[required(), notBlank(), maxLength(60)]` produced three messages: `This field is required.`, `Must not be blank.` and `Must be at most 60 characters.`. Show `firstFor()` when one is enough.
- **`required()` lets `'   '` through.** Add `notBlank()`.
- **Without `required()`, an empty value skips every rule.** A rule such as `minLength(8)` on an optional field does not run on `''`.
- **A 422 for a browser has no body.** `validateOrFail()` answers JSON only when `Accept` lists it. HTML forms use `validate()`.
- **Validation is not sanitising.** The input is checked, not changed: trim, cast and normalise it yourself after it passes.
- **Validate on the server, always.** HTML attributes such as `required` or `maxlength` are a convenience for the visitor, not a check.
