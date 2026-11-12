---
title: Système de fichiers
order: 6
description: Lisez, écrivez, copiez et listez des fichiers et des répertoires avec File et Directory, et gardez un chemin fourni par l’utilisateur hors de leur portée.
---

# Système de fichiers

Des fichiers et des répertoires sous forme d’objets.

`File` et `Directory` enveloppent les fonctions de système de fichiers de PHP. Un échec lève une `FileSystemException` au lieu de retourner `false`, les fichiers créés par la classe reçoivent des permissions prévisibles, et une écriture supprime un lien symbolique trouvé à la destination au lieu de le suivre.

## Fichiers

```php
use Zephyrus\FileSystem\File;

$file = File::create($root . '/storage/reports/2026.txt', "alpha\nbeta\n");

$file->read();      // "alpha\nbeta\n"
$file->lines();     // ['alpha', 'beta']
$file->append("gamma\n");
$file->write("replaced\n");
```

`File::create($path, $content = '')` crée le fichier, ainsi que tout répertoire parent manquant, et retourne un `File`. Pour envelopper un fichier qui existe, ou qui n’existe peut-être pas encore, utilisez `new File($path)`.

| Méthode | Ce qu’elle fait |
|---|---|
| `read()` | Tout le contenu, sous forme de chaîne. |
| `lines($trimNewlines = true)` | Le contenu sous forme de liste de lignes. |
| `write($content)` | Remplace le contenu. |
| `append($content)` | Ajoute à la fin. |
| `size()` | La taille en octets. |
| `mimeType()` | Le type de média détecté à partir du contenu : `text/plain` pour le fichier ci-dessus. |
| `extension()` | L’extension sans le point, `txt`. |
| `hash($algo = 'sha256')` | L’empreinte du contenu : 64 caractères hexadécimaux pour `sha256`. |
| `copy($destination)` | Copie le fichier et retourne le nouveau `File`. Les répertoires manquants sont créés. |
| `move($destination)` | Renomme ou déplace le fichier et retourne le `File` au nouvel emplacement. |
| `delete()` | Supprime le fichier. Il ne se passe rien s’il a déjà disparu. |

`copy()` et `move()` retournent le fichier à la destination. L’objet source d’avant `move()` indique `exists()` à `false` :

```php
$copy = $file->copy($root . '/storage/archive/2026-copy.txt');
$moved = $copy->move($root . '/storage/archive/2027.txt');
```

Un fichier que `File` crée (`create()`, `write()` ou `copy()` vers un chemin qui n’existait pas) reçoit le mode `File::DEFAULT_PERMISSIONS`, `0644`, quel que soit l’umask du processus. Cela inclut un umask restrictif : sous `umask(0077)`, un fichier créé par `File::create()` est tout de même `0644`, lisible par tous les utilisateurs locaux, là où `file_put_contents()` donnerait `0600`. Pour un fichier privé, appelez ensuite `chmod()` dessus ou gardez-le dans un répertoire que seul votre utilisateur peut ouvrir.

Avant d’écrire, `create()`, `write()` et `copy()` suppriment un lien symbolique trouvé à la destination et écrivent un fichier ordinaire à sa place. La vérification et l’écriture sont deux étapes : ce n’est donc pas une garantie contre quelqu’un qui vous devancerait dans un répertoire où il peut écrire. `append()` suit toujours un lien.

## Répertoires

```php
use Zephyrus\FileSystem\Directory;

$archive = Directory::ensure($root . '/storage/archive');

$archive->files('*.txt');       // File[] (this directory only)
$archive->directories();        // Directory[] (immediate subdirectories)
$archive->glob('*.csv');        // list of paths (this directory only)
$archive->recursiveGlob('*.csv'); // list of paths (every level)
```

`Directory::ensure($path, $permissions = 0755)` crée le répertoire, avec ses parents, lorsqu’il est manquant, et le retourne. `new Directory($path)` ne fait qu’envelopper un chemin.

| Méthode | Ce qu’elle fait |
|---|---|
| `files($pattern = '*')` | Les fichiers situés directement à l’intérieur, sous forme d’objets `File`. |
| `directories()` | Les sous-répertoires immédiats, sous forme d’objets `Directory`. |
| `glob($pattern)` | Les chemins correspondant à un motif glob dans ce répertoire. |
| `recursiveGlob($pattern)` | Les chemins correspondant au motif à toutes les profondeurs. |
| `create($permissions = 0755)` | Crée le répertoire lorsqu’il n’existe pas. |
| `delete($recursive = false)` | Le supprime. Un répertoire non vide exige `true`. |
| `size()` | La taille totale de chaque fichier à l’intérieur, en octets. |
| `isEmpty()` | Indique s’il ne contient rien. |

Avec un répertoire `archive` contenant `2027.txt`, `a.csv` et `deep/b.csv`, ces appels ont donné `2027.txt`, `deep`, un chemin et deux chemins. `size()` valait `9` et `isEmpty()` valait `false`.

`delete(true)` supprime d’abord le contenu et lève une exception à la première entrée qu’il ne peut pas supprimer : une purge partielle n’est donc jamais signalée comme un succès. Un lien symbolique à l’intérieur est délié, jamais suivi : la cible survit. N’appelez jamais `delete(true)` sur un chemin qui peut lui-même être un lien symbolique : il vide la cible du lien, puis lève une exception. `delete()` sans `true` sur un répertoire qui a encore du contenu lève `Failed to delete directory: <path>`.

## Ce que sait un nœud

`File` et `Directory` partagent la classe de base `FileSystemNode` :

| Méthode | Ce qu’elle retourne |
|---|---|
| `path()` | Le chemin tel qu’il a été donné. |
| `name()` | Le dernier segment, `2026.txt`. |
| `parent()` | Le chemin du répertoire parent. |
| `exists()` | Indique si le chemin existe sur le disque. |
| `isReadable()`, `isWritable()` | Les vérifications PHP correspondantes. |
| `permissions()` | Le mode sous forme d’entier : `decoct($file->permissions())` vaut `644`. |
| `lastModified()` | L’heure de modification sous forme d’horodatage Unix. |

Vous n’instanciez pas `FileSystemNode` vous-même.

## Erreurs

Chaque échec est une `FileSystemException`. Ses messages nomment le chemin :

```php
use Zephyrus\FileSystem\FileSystemException;

try {
    $text = (new File($root . '/storage/missing.txt'))->read();
} catch (FileSystemException $e) {
    // Path not found: /var/www/storage/missing.txt
}
```

Les autres messages sont `Path is not readable: ...`, `Path is not writable: ...`, `Path already exists: ...` et `Failed to <operation>: ...`, par exemple `Failed to delete directory: ...`. Ils contiennent des chemins du serveur : journalisez-les, ne les envoyez jamais à un client.

Les méthodes qui exigent un fichier existant (`read()`, `size()`, `lines()`, `copy()`, `move()`, `permissions()`...) lèvent `Path not found` lorsqu’il est manquant. `exists()` ne lève jamais d’exception.

## Les chemins issus d’une requête

`File` et `Directory` agissent sur n’importe quel chemin qu’on leur donne : `../../etc/passwd` sort d’un répertoire de base, tout comme un lien symbolique qui s’y trouve. Ne joignez jamais une entrée de la requête à un chemin de base. Choisissez l’une ou l’autre de ces approches :

- stocker sous un nom que vous générez, comme le fait l’uploader (voir [Téléversements](../uploads/)), et conserver dans votre base de données la correspondance avec le nom du client ;
- ou contraindre strictement le paramètre de route, de sorte que rien d’autre qu’un simple nom de fichier ne puisse arriver :

```php
namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\FileSystem\File;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;

#[Middleware('auth')]
final class ExportController extends Controller
{
    #[Get('/exports/{name}', constraints: ['name' => '[A-Za-z0-9_-]+\.csv'])]
    public function download(string $name): Response
    {
        $file = new File(dirname(__DIR__, 2) . '/storage/exports/' . $name);
        if (!$file->exists()) {
            return $this->text('Not found', 404);
        }

        return new Response($file->read(), 200, [
            'Content-Type' => 'text/csv',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
```

Le motif ne contient ni barre oblique ni point, sauf pour l’extension : le nom ne peut donc pas désigner un autre répertoire.

La contrainte vérifie le nom, pas qui a le droit de lire le fichier : le middleware `auth` (voir [Authentification](../../fundamentals/authentication/)) réserve les exportations aux utilisateurs connectés, et une exportation qui appartient à un compte doit aussi être vérifiée contre l’utilisateur courant.

## Bon à savoir

- **Un chemin issu d’une requête n’est pas fiable.** Générez le nom vous-même, ou contraignez strictement le paramètre de route, avant qu’il n’atteigne `File` ou `Directory`.
- **`delete(true)` est définitif.** Une suppression récursive d’un mauvais chemin retire tout ce qui s’y trouve. Construisez le chemin à partir de vos propres constantes.
- **`move()` et `copy()` écrasent la destination.** Vérifiez d’abord `exists()` lorsque cela importe.
- **`glob()` et `recursiveGlob()` retournent des chaînes**, `files()` et `directories()` retournent des objets.
- **Les permissions ne s’appliquent qu’aux nouveaux fichiers.** Un fichier existant conserve son mode lorsque vous y faites un `write()`.
