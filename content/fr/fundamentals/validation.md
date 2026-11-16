---
title: Validation
order: 8
description: Validez les entrées d’une requête avec FormValidator et les Rules intégrées, écrivez votre propre règle et réaffichez les erreurs et les anciennes valeurs dans un formulaire.
---

# Validation

Vérifiez les entrées avant de leur faire confiance.

Un `FormValidator` contient une liste de règles par champ. Vous lui donnez un tableau de données, il vous rend un `ErrorBag`. Rien n’est lu de la requête à votre place, et rien n’est lancé à moins que vous ne le demandiez.

## Valider des données

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

`$request->body()->all()` est le corps de formulaire ou JSON décodé (voir [HTTP](../http/)). Avec les données `['email' => 'nope', 'age' => '12']`, `$errors->toArray()` donne :

```json
{
    "email": ["Must be a valid email address."],
    "age": ["Must be between 18 and 120."]
}
```

Les règles d’un champ s’exécutent dans l’ordre où vous les listez, et chaque règle qui échoue ajoute son message : un champ ne s’arrête jamais à son premier échec. Un `email` manquant avec les règles ci-dessus signale à la fois `This field is required.` et `Must be a valid email address.`. Placez `Rules::required()` en premier et n’affichez que le premier message d’un champ si vous préférez une seule ligne (voir [Afficher les erreurs dans un formulaire](#afficher-les-erreurs-dans-un-formulaire)).

### Champs facultatifs

Un champ **sans** règle `required()` est ignoré lorsque sa valeur est `null` ou une chaîne vide. C’est ce qui rend `age` ci-dessus facultatif : un `age` vide passe, un champ rempli doit être un entier entre 18 et 120.

Un champ **avec** `required()` exécute toutes ses règles même sur les valeurs vides. `required()` refuse `null`, `''` et `[]`, et accepte `'0'`, `0` et `false`. Il accepte aussi `'   '` (que des espaces) : ajoutez `Rules::notBlank()` lorsque les espaces ne doivent pas compter comme une réponse.

### Champs imbriqués

Un nom de champ contenant un point lit dans des tableaux imbriqués : `address.city` regarde `$data['address']['city']`. Une clé manquante, à n’importe quelle profondeur, vaut `null`, et `required()` la signale.

```php
$address = new FormValidator([
    'city' => [Rules::required()],
    'postal' => [Rules::postalCode()],
]);

$form = (new FormValidator(['name' => [Rules::required()]]))
    ->withNested('address', $address);
```

`withNested('address', $address)` fusionne les champs de l’autre validateur sous le préfixe : `city` devient `address.city`.

### Construire un validateur étape par étape

Un `FormValidator` est immuable. `withField($name, $rules)` et `withFields($fields)` retournent une copie avec les champs ajoutés ou remplacés, et `fields()` retourne les règles actuelles. Conservez la valeur retournée :

```php
$form = $form
    ->withField('email', [Rules::required(), Rules::email()])
    ->withFields(['age' => [Rules::integer()]]);
```

### Lancer plutôt que vérifier

`validateOrFail()` retourne le `ErrorBag` (vide) lorsque tout passe et lance une `ValidationException` dans le cas contraire :

```php
$form->validateOrFail($request->body()->all());
```

L’exception porte le sac, et l’application la transforme en réponse 422. Cette réponse est `{"errors":{...}}` lorsque l’en-tête `Accept` de la requête liste JSON. Tout le reste, un navigateur ou un appel `fetch()` sans cet en-tête, reçoit le texte brut `Unprocessable Entity`. Un formulaire HTML devrait donc utiliser `validate()` et afficher de nouveau le formulaire. Réservez `validateOrFail()` aux routes d’API :

```php
use Zephyrus\Validation\ValidationException;

try {
    $form->validateOrFail($input);
} catch (ValidationException $e) {
    $errors = $e->errors(); // the ErrorBag
}
```

Le message de l’exception est `Validation failed.` ; il n’est pas envoyé au client. `ValidationException::fromErrorBag($bag, $message)` en construit une à partir d’un sac que vous avez rempli vous-même.

## Le sac d’erreurs

`ErrorBag` est ce que retourne `validate()`. Vous pouvez aussi en créer un (`new ErrorBag()`) pour y ajouter vos propres erreurs :

| Méthode | Retourne |
|---|---|
| `hasErrors()` | `true` lorsqu’un champ a échoué. |
| `hasErrorsFor($field)` | `true` lorsque ce champ a échoué. |
| `errorsFor($field)` | Les messages d’un champ, `[]` s’il a réussi. |
| `firstFor($field)` | Le premier message d’un champ, ou `null`. |
| `failingFields()` | Les noms des champs qui ont échoué. |
| `allMessages()` | Tous les messages dans une seule liste à plat. |
| `toArray()` | `field => list of messages`. |
| `add($field, $message)` | Ajoute un message. |
| `merge($other)` | Ajoute tous les messages d’un autre sac. |

`merge()` et `add()` servent aux erreurs qui proviennent d’ailleurs que d’une règle, par exemple un nom d’utilisateur déjà pris, ce que seule votre base de données peut dire :

```php
$errors = $form->validate($input);
if ($usernames->exists($input['username'])) {
    $errors->add('username', 'This username is taken.');
}
```

## Afficher les erreurs dans un formulaire

Rendez de nouveau le formulaire avec le statut 422, en renvoyant les données saisies et le sac à la vue (voir [Vues](../views/)) :

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

Le premier affichage du formulaire transmet des valeurs vides : `['old' => [], 'errors' => new ErrorBag()]`. Dans le gabarit, Latte échappe chaque valeur, y compris les anciennes données renvoyées dans un attribut :

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

Avec le nom `   ` et le courriel `bad"<x>`, la page a affiché `value="bad&quot;&lt;x&gt;"` et `Must be a valid email address.` sous le champ. Le champ caché `_csrf_token` est obligatoire sur tout formulaire qui envoie des données (voir [Sécurité](../security/)).

Ne renvoyez jamais un mot de passe : laissez-le hors de `old`. Le message flash de l’exemple est décrit dans [Sessions](../sessions/).

## Règles

Chaque règle est une méthode statique de `Rules` qui retourne une `Rule`. Presque toutes acceptent un dernier argument facultatif, le message d’erreur, avec une valeur par défaut en anglais. Un message personnalisé remplace celui par défaut pour cette règle :

```php
Rules::minLength(8, 'The password needs at least 8 characters.')
```

Les messages sont de simples chaînes et ne sont pas traduits pour vous. Pour les traduire, passez le résultat de `localize()` (voir [Localisation](../localization/)).

Une règle ne lance jamais d’exception sur une valeur du mauvais type : elle échoue. `minLength()` sur un entier échoue, `integer()` sur `true` échoue. Les vérifications ci-dessous sont exactes, alors lisez les notes avant de vous appuyer sur un cas limite.

### Présence et type

| Règle | Accepte |
|---|---|
| `required()` | Tout sauf `null`, `''` et `[]`. Rend le champ obligatoire. |
| `notBlank()` | Une chaîne avec au moins un caractère qui n’est pas une espace. |
| `nonEmptyString()` | La même vérification que `notBlank()`. |
| `boolean()` | `true`, `false`, `1`, `0`, `'1'`, `'0'`, `'true'`, `'false'` (peu importe la casse). |
| `integer()` | Un entier, une chaîne d’entier (`'5'`, `'+5'`) ou un nombre à virgule entier. Pas `true`, `5.5`, `'05'` ni `'5.0'`. |
| `numeric()` | Un entier, un nombre à virgule ou une chaîne numérique (le `is_numeric` de PHP). |
| `integerString()` | Une chaîne composée d’un signe moins facultatif et de chiffres. |
| `decimalString($scale = 2)` | Une chaîne avec un signe moins facultatif et au plus `$scale` décimales. |
| `in($allowed)` | Une valeur strictement égale à l’une de `$allowed`. |
| `inCaseInsensitive($values)` | Une chaîne égale à l’une de `$values`, sans tenir compte de la casse. |

### Longueur, taille et nombre

| Règle | Accepte |
|---|---|
| `minLength($min)`, `maxLength($max)` | Une chaîne d’au moins ou d’au plus ce nombre de caractères (compatible multioctet). |
| `min($min)`, `max($max)` | Un nombre au moins ou au plus égal à la borne. |
| `greaterThan($min)`, `lessThan($max)` | Un nombre strictement supérieur ou inférieur à la borne. |
| `between($min, $max)` | Un nombre compris dans les bornes, incluses. |
| `betweenExclusive($min, $max)` | Un nombre strictement compris dans les bornes. |
| `countMin($min)`, `countMax($max)` | Un tableau d’au moins ou d’au plus ce nombre d’éléments. |

### Texte et motifs

| Règle | Accepte |
|---|---|
| `regex($pattern, $message)` | Une chaîne qui correspond à un motif PCRE complet. Le message est obligatoire. |
| `ascii()` | Une chaîne d’octets ASCII seulement. |
| `alphaNumeric()` | Une chaîne non vide de lettres et de chiffres ASCII. |
| `startsWith($prefix)`, `endsWith($suffix)`, `contains($needle)` | Une chaîne avec ce préfixe, ce suffixe ou ce contenu (octet par octet, sensible à la casse). |
| `lowercase()`, `uppercase()` | Une chaîne que la mise en minuscules ou en majuscules ne modifie pas. |
| `noWhitespace()` | Une chaîne non vide sans espace blanc. |
| `slug()` | Des lettres minuscules et des chiffres reliés par des traits d’union simples. |
| `base64()`, `base64Url()` | Du Base64 canonique, ou du Base64URL sans remplissage. |
| `json()`, `jsonObject()`, `jsonArray()` | Du texte JSON, un objet JSON, un tableau JSON. |
| `jsonPointer()` | Un pointeur JSON RFC 6901. |

`regex()` prend un motif avec délimiteurs. Terminez-le par `\z` ou ajoutez le modificateur `D` : un `$` seul correspond aussi avant un saut de ligne final, et `/^[A-Z]{2}\d{3}$/` accepterait `"AB123\n"`.

### Web et réseau

| Règle | Accepte |
|---|---|
| `email()` | Ce qu’accepte `FILTER_VALIDATE_EMAIL` de PHP. |
| `url()` | Une URL avec n’importe quel schéma (`ftp://example.com` passe). |
| `httpUrl()` | Une URL absolue avec le schéma `http` ou `https`. Utilisez celle-ci pour les liens que vous afficherez ou suivrez. |
| `hostname()`, `host()`, `hostPort()` | Un nom DNS, un nom ou une adresse IP, ou `host:port` (IPv6 entre crochets). |
| `ip()`, `ipv4()`, `ipv6()` | Une adresse IP. La notation CIDR est refusée. |
| `privateIp()`, `publicIp()` | Une adresse dans une plage privée ou réservée, ou en dehors de celles-ci. |
| `cidr()`, `subnetMask()` | Un bloc CIDR (`10.0.0.0/8`, sans bits d’hôte définis), ou un masque IPv4. |
| `port()`, `portRange()` | Un port de 1 à 65535, ou `start-end`. |
| `macAddress()` | Six paires hexadécimales séparées par `:` ou `-`. |
| `httpPath()`, `pathSegment()`, `queryString()`, `percentEncoded()` | Des parties d’une URL. |

### Dates et heures

| Règle | Accepte |
|---|---|
| `date($format = 'Y-m-d')` | Une chaîne qui fait l’aller-retour par le format : `2026-02-30` est refusée. |
| `dateTime($format = 'Y-m-d H:i:s')` | La même chose, pour une date et une heure. |
| `rfc3339DateTime()` | Une date-heure RFC 3339 en secondes entières avec `Z` ou un décalage. |
| `time24()` | `HH:MM` de `00:00` à `23:59`. |
| `timezone()` | Un identifiant de `DateTimeZone::listIdentifiers()`. Les alias comme `America/Montreal` sont refusés. |
| `unixTimestamp()`, `epochMilliseconds()` | Un nombre entier non négatif de secondes ou de millisecondes. |
| `cronExpression()` | Cinq champs séparés par des espaces. Les valeurs des champs ne sont pas vérifiées par plage. |

### Identifiants et codes

| Règle | Accepte |
|---|---|
| `uuid()`, `uuidV1toV5()`, `uuidV4()`, `uuidV6()`, `uuidV7()`, `uuidV8()` | Un UUID de n’importe quelle forme, ou de la version indiquée. |
| `ulid()`, `sha256()`, `semver()` | Un ULID, une empreinte hexadécimale minuscule de 64 caractères, une version comme `1.4.0` (sans `v` initial). |
| `phoneE164()` | `+` puis 2 à 15 chiffres, le premier n’étant pas zéro. |
| `postalCode()` | 3 à 13 lettres, chiffres, espaces ou traits d’union. La forme seulement, pas le format d’un pays. |
| `hexColor()` | `#RGB` ou `#RRGGBB`. |
| `countryCode()`, `currencyCode()`, `locale()`, `languageTag()` | La forme d’un code de pays, d’un code de devise, de `en_CA`, d’une balise BCP-47. Les valeurs ne sont pas vérifiées dans un registre. |
| `latitude()`, `longitude()` | Un nombre de -90 à 90, ou de -180 à 180. |
| `iban()`, `bic()` | La forme d’un IBAN ou d’un BIC. Aucune somme de contrôle et aucun registre bancaire. |
| `cardNumber()`, `cardNumberLuhn()`, `cardCvv()` | 12 à 19 chiffres (avec ou sans somme de contrôle de Luhn), ou un code de 3 ou 4 chiffres. |
| `cardExpiryMmyy()`, `cardExpiryMmyyyy()` | `MM/YY` ou `MM/YYYY`. La date n’est pas comparée à aujourd’hui. |

### Fichiers et noms

| Règle | Accepte |
|---|---|
| `safeFilename()` | Jusqu’à 255 lettres, chiffres, `.`, `_` ou `-`, commençant par une lettre ou un chiffre, sans `..`. |
| `fileExtension()` | 1 à 10 lettres ou chiffres ASCII, sans le point. |
| `mimeType()` | Un jeton `type/subtype`. Les paramètres comme `; charset=` sont refusés. |

Le nom de fichier fourni par un client n’est jamais un nom sûr en soi : voir [Téléversements](../../digging-deeper/uploads/) pour le stockage des fichiers.

### Valeurs du protocole HTTP

Pour les API qui reçoivent des en-têtes ou des valeurs de protocole comme données : `httpStatusCode()` (100 à 599), `httpMethod()`, `httpVersion()`, `bearerToken()`, `jwt()` (le format du jeton, pas sa signature), `acceptLanguage()`, `httpHeaderName()`, `httpHeaderValue()`, `etag()`, `ifMatch()`, `ifNoneMatch()`, `httpDate()`, `ifModifiedSince()`, `ifUnmodifiedSince()`, `ifRange()`, `byteRange()` et `contentRange()`.

## Votre propre règle

`Rule::of()` prend une fermeture qui retourne `true` lorsque la valeur est valide, et le message à signaler :

```php
use Zephyrus\Validation\Rule;

$form = new FormValidator([
    'code' => [Rule::of(fn (mixed $value): bool => $value === 'ok', 'Wrong code.')],
]);
```

La fermeture reçoit la valeur du champ, quel que soit son type : vérifiez-la avant de l’utiliser. Pour comparer un champ avec un autre, fermez sur les données saisies :

```php
$input = $request->body()->all();

$form = new FormValidator([
    'confirm' => [Rule::of(fn (#[\SensitiveParameter] mixed $value): bool => $value === ($input['password'] ?? null), 'Does not match.')],
]);
```

Le framework masque la valeur en cours de validation dans une trace de pile (`#[\SensitiveParameter]` sur `Rule::test()`, `FormValidator::validate()` et chaque règle de `Rules`), si bien qu’une exception levée pendant une validation ne garde pas un mot de passe dans `getTrace()`. La fermeture que vous donnez à `Rule::of()` est à marquer par vous : quand elle reçoit un secret, placez `#[\SensitiveParameter]` sur son paramètre, comme ci-dessus, sinon son propre cadre de la trace contient encore la valeur.

Le troisième argument facultatif est une étiquette. Seule l’étiquette `required` a un sens pour le validateur (c’est ce que porte `Rules::required()`). Une règle est aussi appelable à la main : `$rule->test($value)` retourne le verdict, `$rule->errorMessage()` le message et `$rule->tag()` l’étiquette.

## Bon à savoir

- **Chaque règle qui échoue le signale.** Un `name` manquant avec `[required(), notBlank(), maxLength(60)]` a produit trois messages : `This field is required.`, `Must not be blank.` et `Must be at most 60 characters.`. Affichez `firstFor()` lorsqu’un seul suffit.
- **`required()` laisse passer `'   '`.** Ajoutez `notBlank()`.
- **Sans `required()`, une valeur vide ignore toutes les règles.** Une règle comme `minLength(8)` sur un champ facultatif ne s’exécute pas sur `''`.
- **Un 422 pour un navigateur n’a pas de corps.** `validateOrFail()` ne répond en JSON que lorsque `Accept` le liste. Les formulaires HTML utilisent `validate()`.
- **Valider n’est pas assainir.** Les données sont vérifiées, pas modifiées : nettoyez-les, convertissez-les et normalisez-les vous-même une fois qu’elles ont passé.
- **Validez toujours côté serveur.** Les attributs HTML comme `required` ou `maxlength` sont une commodité pour le visiteur, pas une vérification.
