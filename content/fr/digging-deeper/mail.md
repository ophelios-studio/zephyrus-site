---
title: Courriel
order: 4
description: Envoyez des courriels texte et HTML par SMTP avec le constructeur Mailer, générez les corps avec une vue, gérez les échecs et testez les envois sans rien expédier.
---

# Courriel

Un courriel, construit comme n’importe quelle autre valeur.

`Zephyrus\Mailer\Mailer` est un constructeur fluide au-dessus de PHPMailer. Vous décrivez un message, appelez `send()`, et vous obtenez soit le silence, soit une `MailerException` qui vous indique de quel type d’échec il s’agit.

## Configuration

Le mailer ne fait pas partie des cinq sections intégrées : enregistrez-le donc par son nom lorsque vous chargez la configuration :

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

| Clé | Par défaut | Signification |
|---|---|---|
| `smtp.host` | `localhost` | Le serveur SMTP. |
| `smtp.port` | `587` | Habituellement 587 avec `tls`, 465 avec `ssl`. |
| `smtp.username`, `smtp.password` | vide | L’authentification est activée dès que l’un des deux est défini. Si `MAIL_USER` et `MAIL_PASSWORD` ne sont pas définis, les valeurs sont vides et l’authentification est ignorée. Lisez le mot de passe avec `!env`, ne l’écrivez jamais dans le fichier. |
| `smtp.encryption` | `tls` | `tls` (STARTTLS), `ssl` (TLS implicite) ou `''` pour aucun chiffrement. |
| `from.address`, `from.name` | vide | L’expéditeur de chaque message. Une valeur qui n’est pas une adresse est refusée à la création du `Mailer`. |

`smtp.encryption` est une liste d’autorisation : toute autre valeur, `none` incluse, interrompt le démarrage avec une erreur qui énumère les trois valeurs acceptées. Une valeur vide désactive complètement le chiffrement et est destinée à un puits local ; lorsque des identifiants sont définis, le mailer écrit un avertissement dans le journal d’erreurs une fois par processus. Avec `tls` ou `ssl`, le certificat du serveur est vérifié : un serveur SMTP de développement a donc besoin d’un certificat auquel PHP fait confiance, faute de quoi la connexion échoue avec `certificate verify failed`.

`MailerConfig::fromArray([...])` construit le même objet à partir d’un simple tableau (clés imbriquées `smtp` et `from`), ce qui est pratique dans les tests. Le mot de passe est masqué lorsque l’objet est affiché.

## Envoyer un message

```php
use Zephyrus\Mailer\Mailer;

(new Mailer($mailerConfig))
    ->to('ada@example.com', 'Ada')
    ->subject('Welcome')
    ->text('Hello Ada')
    ->send();
```

Chaque méthode retourne le mailer. Le constructeur offre :

| Méthode | Effet |
|---|---|
| `to($address, $name = '')`, `cc(...)`, `bcc(...)` | ajoutent un destinataire |
| `replyTo($address, $name = '')` | définit un Reply-To |
| `subject($subject)` | définit le sujet |
| `text($body)` | le corps en texte brut, ou l’alternative d’un corps HTML |
| `html($body)` | le corps HTML |
| `template($page, $args)` | génère une vue comme corps HTML (voir plus bas) |
| `attach($path, $name = '', $allowedRoot = null)` | joint un fichier |
| `attachContent($bytes, $name, $mimeType = null)` | joint des octets conservés en mémoire |
| `send()` | envoie, ou lève une `MailerException` |
| `getPhpMailer()` | le `PHPMailer` sous-jacent pour tout ce qui n’est pas couvert ici |

Avec `text()` seulement, le message est en texte brut. Avec `html()` seulement, il est en HTML. Avec les deux, il est `multipart/alternative`, et les clients de messagerie choisissent la partie qu’ils préfèrent : envoyez les deux pour tout ce qu’une personne lit.

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

Une adresse est validée au moment où vous l’ajoutez. Une adresse qui contient un saut de ligne, ou qui n’en est pas une, lève immédiatement une exception : un champ de formulaire ne peut donc pas introduire en contrebande un en-tête dans le message.

Le HTML que vous assemblez à la main doit échapper les valeurs qu’il intègre, comme ci-dessus avec `e()`. Un gabarit le fait pour vous.

Construisez un `Mailer` par message. `send()` conserve les destinataires : réutiliser une instance envoie donc le message suivant aussi aux adresses précédentes.

## Générer le corps avec une vue

Donnez au `Mailer` un moteur de rendu comme second argument, et `template()` génère une vue comme corps HTML :

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

`{$name}` est échappé par Latte. `template()` ne définit que la partie HTML : ajoutez donc `text()` pour obtenir l’alternative. Appeler `template()` sans moteur de rendu lève une `MailerException` dont l’échec est `configuration_missing`. Voyez [Vues](../../fundamentals/views/) pour le moteur lui-même.

## Pièces jointes

```php
(new Mailer($mailerConfig))
    ->to('ada@example.com')
    ->subject('Files')
    ->text('See attached')
    ->attach($reportPath, 'report.txt', allowedRoot: $reportsDirectory)
    ->attachContent($pdfBytes, 'invoice.pdf', 'application/pdf')
    ->send();
```

- `attach()` refuse un chemin contenant un octet NUL ou un enveloppeur de flux (stream wrapper), ainsi qu’un fichier inexistant. Lorsqu’une partie du chemin provient de l’extérieur de votre code, passez `$allowedRoot` : le fichier doit alors se résoudre à l’intérieur de ce répertoire après le suivi des liens symboliques et des `..`.
- Le nom affiché doit être un simple nom de fichier : sans séparateur de chemin, caractère de contrôle, `=?` ni point final, et d’au plus 255 octets. Sans nom, le nom propre du fichier est utilisé et soumis aux mêmes règles.
- `attachContent()` accepte un type de média de la forme `type/subtype`, avec des paramètres facultatifs. `name`, `filename` et `boundary` sont définis par le mailer. Avec `null`, le type suit l’extension du nom.
- Ne construisez jamais un nom de fichier ou un chemin à partir d’une entrée du client. Choisissez vous-même le nom et gardez les fichiers dans un répertoire que vous contrôlez.

## Échecs

Chaque échec est une `MailerException`. Sa propriété `failure` est un cas de `MailerFailure` : vous aiguillez donc selon une valeur au lieu d’analyser du texte :

| `MailerFailure` | Quand |
|---|---|
| `InvalidAddress` | un destinataire, un reply-to ou `from.address` n’est pas une adresse |
| `SendFailed` | le transport n’a pas accepté le message : refus de connexion, d’authentification ou de relais |
| `RecipientsRefused` | certains destinataires ont été refusés ; les autres ont peut-être reçu le message, de sorte qu’un nouvel envoi peut le dupliquer |
| `AttachmentNotFound` | un fichier joint n’existe pas |
| `AttachmentRejected` | le chemin, le nom, le type de média ou le répertoire d’une pièce jointe a été refusé |
| `ConfigurationMissing` | `template()` a été appelée sans moteur de rendu |

```php
use Zephyrus\Mailer\MailerException;

try {
    $mailer->send();
} catch (MailerException $e) {
    error_log($e->failure->value . ': ' . $e->transportMessage());
    // show the visitor a fixed message, never the exception
}
```

Pour `SendFailed` et `RecipientsRefused`, le message de l’exception est un texte fixe qui ne contient ni adresse ni réponse du serveur :

```text
The mail transport did not accept the message; the reason is withheld, read transportMessage() (it may name recipients).
```

La réponse propre du serveur est accessible par `transportMessage()` (par exemple `SMTP Error: Could not connect to SMTP host. Failed to connect to server`). Elle peut nommer des destinataires : gardez-la dans vos journaux et hors des réponses.

Les autres messages s’adressent aux développeurs et peuvent être journalisés sans risque : `Invalid email address given to to().`, `Attachment rejected: display name "../etc/passwd" contains a path separator; pass a bare file name.`, `Mailer configuration missing: A RenderEngine is required for template-based emails.`

L’envoi est synchrone : la requête attend la conversation SMTP. Un serveur lent ou injoignable ralentit donc la page. Pour tout ce qu’un visiteur ne devrait pas attendre, envoyez depuis une file d’attente ou un travailleur en ligne de commande.

## Tester sans envoyer

`Mailer` est une classe `final` : cachez-la donc derrière une interface de votre cru et donnez à vos tests une doublure. L’interface dit ce que votre application envoie, non comment :

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

Un test du code qui envoie le courriel de bienvenue passe une doublure qui enregistre l’appel. Un test du message lui-même le construit et demande à PHPMailer de l’assembler avec `preSend()`, qui n’ouvre jamais de connexion :

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

Pour exercer la véritable conversation SMTP, pointez `smtp.host` vers un serveur de capture local (un collecteur de courriels de développement, ou un petit script qui accepte les connexions et stocke chaque message) avec `encryption: ''`, puis lisez ce qu’il a reçu. Ne dirigez jamais une exécution de tests vers un vrai serveur.

## Bon à savoir

- Un `Mailer` par message : un second `to()` sur une instance déjà utilisée s’ajoute aux anciens destinataires.
- `smtp.encryption: ''` envoie les identifiants en clair. Réservez-le à un puits local.
- Échappez chaque valeur que vous placez dans `html()`. Utilisez un gabarit pour tout ce qui contient des données d’utilisateur.
- Un destinataire refusé ne signifie pas que rien n’a été envoyé : avec `RecipientsRefused`, les destinataires acceptés ont peut-être déjà reçu le message.
- N’affichez pas `transportMessage()` aux visiteurs, et ne le journalisez pas tel quel dans un système partagé : il peut contenir des adresses.
