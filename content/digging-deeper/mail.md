---
title: Mail
order: 4
description: Send text and HTML email over SMTP with the Mailer builder, render bodies with a view, handle failures, and test mail without sending it.
---

# Mail

An email, built like any other value.

`Zephyrus\Mailer\Mailer` is a fluent builder over PHPMailer. You describe one message, call `send()`, and get either silence or a `MailerException` that tells you what kind of failure it was.

## Configuration

The mailer is not one of the six built-in sections, so register it by name when you load the configuration:

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Mailer\MailerConfig;

$config = Configuration::fromYamlFile($root . '/config.yml', ['mailer' => MailerConfig::class]);
$mailerConfig = $config->section('mailer');   // a MailerConfig
```

```yaml
mailer:
  smtp:
    host: !env MAIL_HOST, localhost
    port: !env MAIL_PORT, 587
    username: !env MAIL_USER
    password: !env MAIL_PASSWORD
    encryption: tls
  from:
    address: !env MAIL_FROM_ADDRESS, no-reply@example.com
    name: Example App
```

| Key | Default | Meaning |
|---|---|---|
| `smtp.host` | `localhost` | The SMTP server. |
| `smtp.port` | `587` | Usually 587 with `tls`, 465 with `ssl`. |
| `smtp.username`, `smtp.password` | empty | Authentication is turned on when either is set. An unset `MAIL_USER` and `MAIL_PASSWORD` give empty values and authentication is skipped. Read the password with `!env`, never write it in the file. |
| `smtp.encryption` | `tls` | `tls` (STARTTLS), `ssl` (implicit TLS) or `''` for no encryption at all. |
| `from.address`, `from.name` | empty | The sender of every message. A value that is not an address is refused when the `Mailer` is created. |

`smtp.encryption` is an allowlist: any other value, `none` included, stops the boot with an error that lists the three accepted values. An empty value disables encryption entirely and is meant for a local sink; with credentials set, the mailer writes a warning to the error log once per process. With `tls` or `ssl` the server certificate is verified, so a development SMTP server needs a certificate PHP trusts, otherwise the connection fails with `certificate verify failed`.

A key the section does not know, under `mailer:` or inside `smtp:` and `from:`, stops the boot with a `ConfigurationException` that names the closest accepted key (`Configuration section 'mailer' field 'smtp.hots' is an unknown key: did you mean "smtp.host"?`); version 0.14.1 ignored it. `smtp.port` is an integer in the exported object: `!env MAIL_PORT` gives `587`, not `"587"`, in `toArray()`.

`MailerConfig::fromArray([...])` builds the same object from a plain array (nested keys `smtp` and `from`), which is handy in tests. The password is masked when the object is dumped.

## Sending a message

```php
use Zephyrus\Mailer\Mailer;

(new Mailer($mailerConfig))
    ->to('ada@example.com', 'Ada')
    ->subject('Welcome')
    ->text('Hello Ada')
    ->send();
```

Every method returns the mailer. The builder has:

| Method | Effect |
|---|---|
| `to($address, $name = '')`, `cc(...)`, `bcc(...)` | add a recipient |
| `replyTo($address, $name = '')` | set a Reply-To |
| `subject($subject)` | set the subject |
| `text($body)` | the plain-text body, or the alternative of an HTML body |
| `html($body)` | the HTML body |
| `template($page, $args)` | render a view as the HTML body (see below) |
| `attach($path, $name = '', $allowedRoot = null)` | attach a file |
| `attachContent($bytes, $name, $mimeType = null)` | attach bytes held in memory |
| `send()` | send, or throw a `MailerException` |
| `getPhpMailer()` | the underlying `PHPMailer` for anything not covered here |

With `text()` only, the message is plain text. With `html()` only, it is HTML. With both, it is `multipart/alternative`, and mail clients pick the part they prefer: send both for anything a person reads.

```php
(new Mailer($mailerConfig))
    ->to('ada@example.com')
    ->cc('team@example.com')
    ->replyTo('help@example.com')
    ->subject('Your receipt')
    ->html('<p>Hello <b>' . e($name) . '</b></p>')
    ->text('Hello ' . $name)
    ->send();
```

An address is validated when you add it. One that contains a line break, or is not an address, throws immediately, so a form field cannot smuggle a header into the message.

HTML you assemble by hand must escape the values it embeds, as above with `e()`. A template does it for you.

Build one `Mailer` per message. `send()` keeps the recipients, so reusing an instance mails the next message to the previous addresses as well.

## Rendering the body with a view

Give the `Mailer` a render engine as its second argument, and `template()` renders a view as the HTML body:

```php
use Zephyrus\Rendering\LatteEngine;

$views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');

(new Mailer($mailerConfig, $views))
    ->to('ada@example.com')
    ->subject('Welcome')
    ->template('welcome', ['name' => 'Ada'])
    ->text('Welcome, Ada. Your account is ready.')
    ->send();
```

```latte
<h1>Welcome, {$name}</h1>
<p>Your account is ready.</p>
```

`{$name}` is escaped by Latte. `template()` sets only the HTML part, so add `text()` to get the alternative. Calling `template()` without a render engine throws a `MailerException` with the failure `configuration_missing`. See [Views](../../fundamentals/views/) for the engine itself.

## Attachments

```php
(new Mailer($mailerConfig))
    ->to('ada@example.com')
    ->subject('Files')
    ->text('See attached')
    ->attach($reportPath, 'report.txt', allowedRoot: $reportsDirectory)
    ->attachContent($pdfBytes, 'invoice.pdf', 'application/pdf')
    ->send();
```

- `attach()` refuses a path with a NUL byte or a stream wrapper, and a file that does not exist. When any part of the path comes from outside your code, pass `$allowedRoot`: the file must then resolve inside that directory after symbolic links and `..` are followed.
- The display name must be a bare file name: no path separator, control character, `=?` or trailing dot, and at most 255 bytes. Without a name, the file's own name is used and is held to the same rules.
- `attachContent()` takes a media type of the form `type/subtype`, optionally with parameters. `name`, `filename` and `boundary` are set by the mailer. With `null`, the type follows the extension of the name.
- Never build a file name or a path from client input. Pick the name yourself and keep the files in a directory you control.

## Failures

Every failure is a `MailerException`. Its `failure` property is a `MailerFailure` case, so you branch on a value instead of parsing text:

| `MailerFailure` | When |
|---|---|
| `InvalidAddress` | a recipient, reply-to or `from.address` is not an address |
| `SendFailed` | the transport did not accept the message: connection, authentication or relay refusal |
| `RecipientsRefused` | some recipients were refused; the others may have received the message, so a resend can duplicate it |
| `AttachmentNotFound` | an attachment file does not exist |
| `AttachmentRejected` | an attachment path, name, media type or directory was refused |
| `ConfigurationMissing` | `template()` was called with no render engine |

```php
use Zephyrus\Mailer\MailerException;

try {
    $mailer->send();
} catch (MailerException $e) {
    error_log($e->failure->value . ': ' . $e->transportMessage());
    // show the visitor a fixed message, never the exception
}
```

For `SendFailed` and `RecipientsRefused` the exception message is fixed text that carries no address and no server reply:

```text
The mail transport did not accept the message; the reason is withheld, read transportMessage() (it may name recipients).
```

The server's own reply is available from `transportMessage()` (for example `SMTP Error: Could not connect to SMTP host. Failed to connect to server`). It can name recipients, so keep it in your logs and out of responses.

The other messages are developer-facing and safe to log: `Invalid email address given to to().`, `Attachment rejected: display name "../etc/passwd" contains a path separator; pass a bare file name.`, `Mailer configuration missing: A RenderEngine is required for template-based emails.`

Sending is synchronous: the request waits for the SMTP conversation. A slow or unreachable server therefore slows the page. For anything a visitor should not wait for, send from a queue or a command-line worker.

## Testing without sending

`Mailer` is a `final` class, so hide it behind an interface of your own and give your tests a double. The interface says what your application sends, not how:

```php
namespace App\Mail;

use Zephyrus\Mailer\Mailer;
use Zephyrus\Mailer\MailerConfig;
use Zephyrus\Rendering\RenderEngine;

interface WelcomeMail
{
    public function send(string $address, string $name): void;
}

final class SmtpWelcomeMail implements WelcomeMail
{
    public function __construct(
        private readonly MailerConfig $config,
        private readonly RenderEngine $views,
    ) {
    }

    public function send(string $address, string $name): void
    {
        (new Mailer($this->config, $this->views))
            ->to($address, $name)
            ->subject('Welcome')
            ->template('welcome', ['name' => $name])
            ->text('Welcome, ' . $name . '. Your account is ready.')
            ->send();
    }
}
```

A test of the code that sends the welcome mail passes a double that records the call. A test of the message itself builds it and asks PHPMailer to assemble it with `preSend()`, which never opens a connection:

```php
use Zephyrus\Mailer\Mailer;
use Zephyrus\Mailer\MailerConfig;

$mailer = new Mailer(MailerConfig::fromArray([
    'smtp' => ['host' => 'localhost', 'port' => 25, 'encryption' => ''],
    'from' => ['address' => 'no-reply@example.com', 'name' => 'Example App'],
]));

$mailer->to('ada@example.com', 'Ada')->subject('Welcome')->html('<p>Hello Ada</p>')->text('Hello Ada');

$php = $mailer->getPhpMailer();
$php->preSend();                        // true
$mime = $php->getSentMIMEMessage();     // headers and body, as they would be sent
```

```php
use PHPUnit\Framework\TestCase;
use Zephyrus\Mailer\Mailer;
use Zephyrus\Mailer\MailerConfig;
use Zephyrus\Mailer\MailerException;
use Zephyrus\Mailer\MailerFailure;

final class MailerTest extends TestCase
{
    public function testAnInvalidRecipientIsRefusedWithItsFailureFamily(): void
    {
        $mailer = new Mailer(MailerConfig::fromArray([
            'smtp' => ['host' => 'localhost', 'port' => 25, 'encryption' => ''],
            'from' => ['address' => 'no-reply@example.com'],
        ]));

        try {
            $mailer->to('not-an-address');
            self::fail('expected a refusal');
        } catch (MailerException $e) {
            self::assertSame(MailerFailure::InvalidAddress, $e->failure);
        }
    }
}
```

To exercise the real SMTP conversation, point `smtp.host` at a local capture server (a development mail catcher, or a small script that accepts connections and stores each message) with `encryption: ''`, and read what it received. Never aim a test run at a real server.

## Good to know

- One `Mailer` per message: a second `to()` on a used instance adds to the old recipients.
- `smtp.encryption: ''` sends credentials in clear text. Use it for a local sink only.
- Escape every value you put in `html()`. Use a template for anything with user data.
- A refused recipient does not mean nothing was sent: with `RecipientsRefused`, the accepted recipients may already have the message.
- Do not show `transportMessage()` to visitors, and do not log it unscrubbed in a shared system: it may contain addresses.
