---
title: Téléversements
order: 5
description: Recevez des fichiers depuis un formulaire, vérifiez-les d’après leurs octets réels, stockez-les sous un nom généré et servez-les de nouveau en toute sécurité.
---

# Téléversements

Des fichiers venus d’inconnus, traités avec soin.

Un téléversement est l’entrée la moins fiable qu’un formulaire puisse envoyer : le nom du fichier, le type déclaré et la taille proviennent tous du client. La classe `Uploader` décide à partir du fichier lui-même et le stocke sous un nom que votre code ou le framework génère.

Le module exige l’extension PHP `fileinfo`, qui détecte le véritable type de média à partir des octets d’un fichier. Activez-la dans chaque image PHP que vous exécutez.

## Recevoir et stocker un fichier

Un formulaire qui envoie un fichier doit être un formulaire `multipart/form-data` et, comme tout formulaire qui envoie des données, il porte le champ CSRF (voir [Sécurité](../../fundamentals/security/)) :

```latte
<form method="post" action="/avatar" enctype="multipart/form-data">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp">
    <button>Upload</button>
</form>
```

Dans le contrôleur, `$request->file('avatar')` retourne un `FileUpload`, ou `null` lorsque le champ est absent. Confiez-le à un `Uploader` :

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Upload\UploadException;
use Zephyrus\Upload\Uploader;

#[Post('/avatar')]
public function store(Request $request): Response
{
    $file = $request->file('avatar');
    if ($file === null) {
        return $this->text('Choose a file.', 422);
    }

    try {
        $path = self::uploader()->store($file, 'avatars');
    } catch (UploadException) {
        return $this->text('This file cannot be accepted. Send a PNG, JPEG or WebP image of 5 MB or less.', 422);
    }

    return $this->json(['path' => $path], 201);
}

private static function uploader(): Uploader
{
    return new Uploader(
        dirname(__DIR__, 2) . '/storage/uploads',
        allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxSizeBytes: 5 * 1024 * 1024,
    );
}
```

`store()` retourne le chemin du fichier stocké **relatif à la racine** que vous avez donnée à l’uploader, par exemple `avatars/0df8ce82f4ef8e35e515a08b17aaf6b7.png`. Conservez cette valeur (dans une colonne de base de données, par exemple) et construisez le chemin complet à partir de votre racine lorsque vous en avez besoin. Le sous-répertoire (`'avatars'`) est créé s’il n’existe pas.

La réponse au visiteur est une phrase fixe. Le message de l’`UploadException` nomme des chemins du serveur et le type détecté : journalisez-le si vous le souhaitez, mais ne l’envoyez jamais au client.

Un champ multiple (`<input type="file" name="photos[]" multiple>`) se lit avec `$request->filesOf('photos')`, une liste de `FileUpload`. `storeMany($files, $subDirectory)` les stocke dans l’ordre et retourne la liste des chemins relatifs. Elle s’arrête au premier fichier qui échoue et laisse en place les précédents :

```php
$paths = self::uploader()->storeMany($request->filesOf('photos'), 'photos');
```

## Ce qui est vérifié, et contre quoi

Rien de ce que dit le navigateur ne décide du résultat :

| Vérification | Effectuée contre |
|---|---|
| `allowedMimeTypes` | Le type détecté à partir des octets du fichier, non le `Content-Type` envoyé par le navigateur. |
| `maxSizeBytes` | La taille réelle du fichier temporaire. |
| `allowedExtensions` | Chaque segment séparé par des points du nom de fichier du client : `avatar.php.png` est refusé à cause de `php`. |
| Là où il atterrit | La destination doit rester sous la racine, une fois les liens symboliques résolus. Un segment `..` dans le sous-répertoire est refusé. |

Un fichier PHP envoyé sous le nom `shell.png` est refusé selon son type détecté, avec `Upload MIME type "text/x-php" is not allowed. Allowed MIME types: image/jpeg, image/png, image/webp`. Un fichier nommé `x.php` qui contient une véritable image PNG est refusé selon son extension, `Upload extension "php" is not allowed. Allowed extensions: jpg, jpeg, png, webp`, de même qu’un fichier sans extension lorsqu’une liste d’autorisation est définie. Un fichier de 3 Mo avec une limite de 100 octets donne `Upload is too large (3000000 bytes). Maximum allowed size is 100 bytes.`

Chaque argument du constructeur après la racine est facultatif :

| Argument | Par défaut | Signification |
|---|---|---|
| `allowedExtensions` | `[]` | Extensions permises dans le nom du client, en minuscules, sans le point. Vide accepte tout. |
| `allowedMimeTypes` | `[]` | Types détectés permis. Vide accepte tout. |
| `maxSizeBytes` | `null` | Taille maximale en octets. `null` signifie aucune limite. |
| `fileMover` | téléversements authentiques seulement | La façon dont le fichier est déplacé (voir [Tester un téléversement](#tester-un-téléversement)). |
| `mimeExtensionMap` | `[]` | Paires supplémentaires ou de remplacement entre type détecté et extension. |
| `overwriteExisting` | `false` | Indique si un fichier existant peut être remplacé. |

Définissez les deux listes blanches. Sans elles, tous les fichiers sont acceptés, y compris des types que vous n’avez jamais voulu recevoir.

### D’où vient le nom du fichier

Lorsque vous ne passez pas de troisième argument à `store()`, le fichier est nommé avec 32 caractères hexadécimaux aléatoires, et son extension provient du type détecté : un PNG reçoit `.png`, peu importe son nom d’origine. Un type détecté qui n’a pas d’entrée dans la table du framework (un type que le framework ne connaît pas) ne reçoit aucune extension. Ajoutez-en une avec `mimeExtensionMap` :

```php
new Uploader($root, mimeExtensionMap: ['application/octet-stream' => 'bin']);
```

La table n’a aucune entrée pour le HTML, le PHP ou les scripts shell, délibérément : un tel fichier est stocké sans extension, de sorte qu’un serveur web ne peut pas le confondre avec quelque chose à exécuter. Elle contient en revanche `image/svg+xml` (vers `.svg`), `application/xml` et `text/xml` (vers `.xml`), et le SVG comme le XML (un document XHTML, notamment) peuvent contenir du script. Servis comme fichiers statiques, ils l’exécutent dans le navigateur, même si le client a nommé le téléversement `avatar.png`. Passez une liste `allowedMimeTypes` explicite sans eux, sauf si vous en avez besoin, et servez-les avec les précautions ci-dessous.

`store($file, $subDirectory, $targetName)` accepte un nom de votre choix. Faites-le seulement pour un nom que votre code construit, tel que `avatar-7.png` à partir d’un identifiant d’utilisateur. Ne passez jamais aucune partie du nom de fichier du client. Un nom que vous passez est vérifié uniquement contre `allowedExtensions`, non contre le type détecté : choisissez donc vous-même son extension parmi les types que vous acceptez. Un nom contenant une barre oblique ou commençant par un point (`.htaccess`) est refusé, et un fichier existant n’est pas remplacé à moins que l’uploader n’ait été construit avec `overwriteExisting: true`.

## Servir un fichier de nouveau

Gardez la racine de stockage à l’extérieur de `public/`. Un fichier dans la racine des documents est une URL que n’importe qui peut demander, et un serveur web décide de la façon de le traiter d’après son extension. Servez les téléversements par un contrôleur qui vérifie qui fait la demande :

```php
use Zephyrus\Routing\Attribute\Get;

#[Get('/avatars/{name}', constraints: ['name' => '[0-9a-f]{32}\.(?:jpg|png|webp)'])]
public function show(string $name): Response
{
    $path = dirname(__DIR__, 2) . '/storage/uploads/avatars/' . $name;
    if (!is_file($path)) {
        return $this->text('Not found', 404);
    }

    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    return new Response((string) file_get_contents($path), 200, [
        'Content-Type' => $types[pathinfo($name, PATHINFO_EXTENSION)],
        'X-Content-Type-Options' => 'nosniff',
        'Cache-Control' => 'private, max-age=3600',
    ]);
}
```

Ce qui rend ceci sûr :

- **La contrainte de route est le filtre.** Seuls les noms de la forme exacte que génère l’uploader atteignent la méthode : `..` et les autres noms répondent donc 404 avant que le moindre code ne s’exécute. La syntaxe des contraintes est décrite sur [Routage](../../fundamentals/routing/).
- **Le type de contenu provient de votre propre table**, indexée par l’extension du nom généré, jamais de la requête ni du téléversement d’origine.
- **`X-Content-Type-Options: nosniff`** empêche un navigateur de deviner un autre type.
- **Ajoutez votre vérification d’accès** (ce visiteur a-t-il le droit de voir ce fichier ?) avant le `file_get_contents()`. Voir [Authentification](../../fundamentals/authentication/).

Pour un fichier qu’un visiteur devrait télécharger plutôt qu’afficher, ajoutez `Content-Disposition: attachment`. Faites-le pour chaque type qui n’est pas une image que vous avez choisie : un SVG ouvert dans le navigateur exécute son script dans l’origine de votre site.

Une requête vers `/avatars/<the generated name>` reçoit une réponse 200 avec `Content-Type: image/png` ; `/avatars/shell.png` et un chemin `..` encodé reçoivent une réponse 404.

## Limites de taille

Trois limites s’empilent, et un fichier doit toutes les respecter :

1. **Les limites propres à PHP**, `upload_max_filesize` (2M par défaut) et `post_max_size` (8M par défaut). Un fichier plus gros n’atteint jamais votre code en tant que fichier : `FileUpload::isValid()` est faux, et `store()` lève `Upload failed: File exceeds the server maximum upload size (upload_max_filesize).` Un fichier de 3 Mo envoyé avec les réglages PHP par défaut est refusé de cette façon, quoi que dise `maxSizeBytes`. Augmentez les deux réglages au-dessus du plus gros fichier que vous acceptez.
2. **Le middleware de taille du corps.** `MaxBodySizeMiddleware` répond 413 pour un corps plus grand que `security.max_body_size`. Pour un corps multipart, il ne peut voir que le `Content-Length` déclaré, ce qui explique pourquoi il ne remplace pas les réglages de PHP. Un téléversement de 7 Mo face à une limite de 6 Mo reçoit la réponse `413 Content Too Large`. Voir [Sécurité](../../fundamentals/security/).
3. **`maxSizeBytes`** sur l’uploader, vérifié contre la taille réelle du fichier.

Définissez `max_body_size` un peu au-dessus de `maxSizeBytes` multiplié par le nombre de fichiers qu’un formulaire peut contenir, puisque le corps comprend aussi les autres champs et l’encadrement multipart.

## Tester un téléversement

Le déplaceur par défaut n’accepte qu’un véritable téléversement HTTP (le `is_uploaded_file()` de PHP) : un fichier que vous avez créé dans un test, ou dans un script en ligne de commande, est donc refusé avec `Refusing to move "...": it is not a genuine PHP upload. Inject a $fileMover when storing files that did not arrive over HTTP.` Injectez un déplaceur qui copie :

```php
use Zephyrus\Upload\FileUpload;
use Zephyrus\Upload\Uploader;

$uploader = new Uploader(
    $root . '/storage/uploads',
    allowedExtensions: ['png'],
    allowedMimeTypes: ['image/png'],
    fileMover: fn (string $from, string $to): bool => copy($from, $to),
);

$file = new FileUpload('me.png', 'image/png', $root . '/tests/files/pixel.png', filesize($root . '/tests/files/pixel.png'));
$path = $uploader->store($file);
```

N’utilisez ce déplaceur que dans les tests : il supprime la garantie que le fichier provient de la requête en cours de traitement.

## FileUpload

`FileUpload` est un objet-valeur immuable. Vous en obtenez un à partir de la requête, ou vous en construisez un vous-même comme ci-dessus (`originalName`, `clientMimeType`, `tmpPath`, `sizeBytes`, `errorCode`) :

| Membre | Ce qu’il donne |
|---|---|
| `originalName`, `clientMimeType`, `sizeBytes` | Ce que le client a prétendu. Affichez-les ; ne décidez jamais avec eux. |
| `tmpPath` | L’endroit où PHP a placé le fichier temporaire. |
| `errorCode` | L’erreur de téléversement de PHP, `UPLOAD_ERR_OK` lorsque tout va bien. |
| `isValid()` | Indique si PHP n’a signalé aucune erreur. |
| `assertValid()` | Lève une `UploadException` qui décrit l’erreur de PHP. |
| `extension()` | La dernière extension du nom du client, en minuscules. |
| `extensions()` | Chaque segment séparé par des points du nom du client : `avatar.php.png` donne `['php', 'png']`. |
| `FileUpload::fromPhpArray($entry)` | En construit un à partir d’une entrée de `$_FILES['field']`. |
| `FileUpload::listFromPhpArray($entry)` | Construit une liste à partir d’une entrée, y compris `photos[]` et les champs imbriqués. |

## UploadException

Chaque refus est une `UploadException` : une erreur de téléversement de PHP, un fichier temporaire manquant ou illisible, un type, une extension ou une taille non permis, un chemin qui s’échappe de la racine, une destination qui existe, un déplacement qui a échoué, et un fichier qui n’est pas un téléversement authentique. Interceptez-la autour de `store()` et répondez avec une phrase de votre cru. Son message est destiné à vos journaux.

## Bon à savoir

- **Définissez les deux listes blanches**, ainsi que la limite de taille. L’`Uploader` sans configuration accepte tout.
- **N’utilisez jamais le nom de fichier du client** pour le stockage, dans un chemin ou dans un en-tête. Utilisez le chemin que `store()` a retourné.
- **Gardez la racine hors de `public/`**, et servez par un contrôleur qui vérifie l’accès.
- **Un type détecté inconnu est stocké sans extension.** Ajoutez-le à `mimeExtensionMap` si vous l’acceptez.
- **Vérifiez aussi les limites de PHP.** `upload_max_filesize` et `post_max_size` refusent un gros fichier avant que `maxSizeBytes` ne soit examiné.
- **Un nom existant n’est pas remplacé.** `store()` lève une exception à moins que `overwriteExisting` ne soit vrai : `Refusing to overwrite the existing file "...". Pass $overwriteExisting to allow replacement.`
