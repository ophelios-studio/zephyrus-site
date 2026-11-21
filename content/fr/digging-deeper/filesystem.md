---
title: Système de fichiers
order: 6
description: Lisez, écrivez, copiez et listez des fichiers et des répertoires avec File et Directory, et gardez un chemin fourni par l’utilisateur hors de leur portée.
---

# Système de fichiers

Des fichiers et des répertoires sous forme d’objets.

`File` et `Directory` enveloppent les fonctions de système de fichiers de PHP. Un échec lève une `FileSystemException` au lieu de retourner `false`, les fichiers créés par la classe reçoivent des permissions prévisibles, et une écriture ne suit jamais un lien symbolique trouvé à la destination.

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
| `append($content, $lockWaitSeconds = 10.0)` | Ajoute à la fin. Attend au plus `$lockWaitSeconds` ses verrous. |
| `size()` | La taille en octets. |
| `mimeType()` | Le type de média détecté à partir du contenu : `text/plain` pour le fichier ci-dessus. |
| `extension()` | L’extension sans le point, `txt`. |
| `hash($algo = 'sha256')` | L’empreinte du contenu : 64 caractères hexadécimaux pour `sha256`. |
| `copy($destination)` | Copie le fichier et retourne le nouveau `File`. Les répertoires manquants sont créés. |
| `move($destination)` | Renomme ou déplace le fichier et retourne le `File` au nouvel emplacement. |
| `delete()` | Supprime le fichier. Il ne se passe rien s’il a déjà disparu (voir [open_basedir](#un-chemin-hors-du-périmètre-openbasedir) pour l’exception). |

`copy()` et `move()` retournent le fichier à la destination. L’objet source d’avant `move()` indique `exists()` à `false` :

```php
$copy = $file->copy($root . '/storage/archive/2026-copy.txt');
$moved = $copy->move($root . '/storage/archive/2027.txt');
```

Un fichier que `File` crée (`create()`, `write()` ou `copy()` vers un chemin qui n’existait pas) reçoit `File::DEFAULT_PERMISSIONS`, `0644`, restreint par l’umask du processus : le mode n’est jamais plus large que ce que l’umask permet. Sous `umask(0077)`, un fichier créé par `File::create()` est `0600`, comme avec `file_put_contents()`, et sous `umask(0022)` il est `0644`. Une nouvelle copie n’est de plus jamais plus large que sa source : copier un fichier `0600` donne un fichier `0600`. Une copie vers une destination existante conserve les permissions de ce fichier. La version 0.14.0 forçait `0644`, quels que soient l’umask et la source.

### Comment une écriture se pose

`create()`, `write()` et `copy()` n’ouvrent jamais un nouveau fichier par son chemin final. Ils écrivent un fichier temporaire dans le même répertoire, puis le renomment sur le chemin, ce qui remplace un lien symbolique qui s’y trouve, même un lien substitué pendant l’appel, au lieu de le suivre : la cible du lien n’est jamais écrite. Un fichier ordinaire existant est écrit sur place par un descripteur, et seulement une fois vérifié que ce descripteur désigne bien le fichier que nomme encore le chemin : il garde son inode, ses liens physiques, son propriétaire et son mode. `copy()` recopie la source dans la destination par flux.

`append()` ne suit jamais un lien non plus : il en refuse un au chemin (`Path is a symbolic link, which is not followed: "<path>"`) ; ajoutez au chemin réel (`realpath()` du lien) ou retirez le lien. Il ajoute sous un `flock()` exclusif, si bien que des appels `append()` concurrents ne s’écrasent jamais. Un rédacteur qui ne prend pas ce verrou, comme `file_put_contents()` avec `FILE_APPEND`, `error_log()` ou un `StreamHandler` de Monolog par défaut, peut encore perdre des lignes dans le même fichier. `append()` attend au plus `$lockWaitSeconds` en tout (10 secondes par défaut) ce verrou et, lorsqu’il crée le fichier, un verrou sur son dossier, puis lève une `FileSystemException` ; `0.0` fait une seule tentative par verrou, et une valeur négative, `NAN` ou infinie lève une `InvalidArgumentException` (`Lock wait must be a finite number of seconds, zero or more: <valeur>`). Une application qui détient volontairement un verrou sur le fichier passe une valeur plus grande : `$file->append($line, 60.0)`.

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

`delete(true)` supprime d’abord le contenu et lève une exception à la première entrée qu’il ne peut pas supprimer : une purge partielle n’est donc jamais signalée comme un succès. Un lien symbolique à l’intérieur est délié, jamais suivi : la cible survit. Supprimer un chemin qui est lui-même un lien symbolique, valide ou orphelin, ne retire que le lien, avec ou sans `true` : sa cible survit. La version 0.14.0 vidait la cible d’un lien valide, puis levait une exception. `delete()` sans `true` sur un répertoire qui a encore du contenu lève `Failed to delete directory: "<path>"`. Un chemin écrit avec un `/.` final est supprimé comme le répertoire qu’il désigne.

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

Chaque échec est une `FileSystemException`. Ses messages nomment le chemin, entre guillemets et échappé :

```php
use Zephyrus\FileSystem\FileSystemException;

try {
    $text = (new File($root . '/storage/missing.txt'))->read();
} catch (FileSystemException $e) {
    // Path not found: "/var/www/storage/missing.txt"
}
```

Un saut de ligne ou un autre caractère de contrôle dans un chemin est échappé (`\n`, `\u0000`), si bien qu’un chemin ne peut pas forger une ligne de journal, et un chemin de plus de 512 octets garde ses 512 derniers octets, suivis de sa longueur. Les autres messages sont `Path is not readable: "..."`, `Path is not writable: "..."`, `Path already exists: "..."` et `Failed to <operation>: "..."`, par exemple `Failed to delete directory: "..."`. Quand PHP a donné une raison pour une écriture, une copie, un déplacement ou une création de répertoire en échec, le message se termine par elle, comme `Failed to create directory for: "/root/reports/2026.txt" ("mkdir(): Permission denied")` pour un `File::create()` là où le processus ne peut pas écrire. Les messages contiennent des chemins du serveur : journalisez-les, ne les envoyez jamais à un client. La version 0.16 copiait les chemins tels quels et omettait la raison de PHP : mettez à jour un test qui compare le texte exact d’un message.

Un chemin que la classe refuse d’écrire est refusé avant la création de tout répertoire ou fichier :

<div class="balanced-table">

| Quand | Message |
|---|---|
| Une URL comme `file://`, `phar://` ou `data:` passée à `create()`, `write()`, `append()`, `copy()` ou `move()` (d’un côté comme de l’autre), `delete()`, ou à `Directory::ensure()`, `create()` et `delete()`. Passez le chemin simple, et écrivez vous-même dans un flux avec `fopen()`. | <code>Path is a stream wrapper URL, which is not written: <span class="nobr">"&lt;path&gt;"</span></code> |
| Les mêmes méthodes, là où PHP levait une `ValueError`. | <code>Path holds a NUL byte, which no file name can: <span class="nobr">"&lt;path&gt;"</span></code> |
| Une destination dont le dernier segment est vide, `.` ou `..`, comme `storage/`. | <code>Path does not end with a file name: <span class="nobr">"&lt;path&gt;"</span></code> |
| Une écriture dans un FIFO ou un périphérique, ou une copie dont la source est un répertoire. | <code>Path is not a regular file: <span class="nobr">"&lt;path&gt;"</span></code> |
| Un fichier existant que le processus peut écrire mais pas lire (mode `0200`) : accordez la lecture. | <code>Path is not readable, which a safe write requires: <span class="nobr">"&lt;path&gt;"</span></code> |
| Un fichier existant dans un répertoire à bit collant comme `/tmp`, qui n’appartient ni au propriétaire du répertoire ni à l’utilisateur du processus. | <code>Path belongs to another user in a shared directory, so it is not written: <span class="nobr">"&lt;path&gt;"</span></code> |
| Une copie sur la source, ou sur un lien physique vers elle. Le fichier reste tel quel. | <code>Cannot copy a file onto itself: <span class="nobr">"&lt;source&gt;"</span> to <span class="nobr">"&lt;destination&gt;"</span></code> |
| Verrou du fichier ou du dossier non obtenu à temps par `append()`. | <code>Lock on the file not acquired within the 10-second wait: <span class="nobr">"&lt;path&gt;"</span></code>, ou <code>Lock on the directory not acquired within the 10-second wait: <span class="nobr">"&lt;directory&gt;"</span></code> |

</div>

### Un chemin hors du périmètre open_basedir

Un chemin que `open_basedir` masque n’affiche aucun avertissement PHP (le `open_basedir restriction in effect` de PHP, qui nomme les chemins permis). `exists()`, `isReadable()` et `isWritable()` retournent `false`, les méthodes qui exigent que le chemin existe lèvent `Path not found`, et `Directory::files()` saute un lien vers un fichier hors des chemins permis. `File::delete()` et `Directory::delete()` lèvent une exception, là où la version 0.16 retournait comme si le chemin était absent :

```text
Failed to delete: "/etc/hostname" ("is_link(): open_basedir restriction in effect. File(/etc/hostname) is not within the allowed path(s): (/var/www)")
```

Un chemin simplement absent est toujours supprimé sans bruit.

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
- **Passez des chemins simples.** Une URL de flux est refusée, `file://` compris.
- **Les permissions ne s’appliquent qu’aux nouveaux fichiers.** Un fichier existant conserve son mode lorsque vous y faites un `write()`.
