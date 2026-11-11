---
title: Vues
order: 7
description: Rendez des gabarits Latte ou PHP simples depuis un contrôleur, transmettez des données, construisez des mises en page et sachez ce que l'échappement automatique protège ou non.
---

# Vues

Des gabarits en entrée, du HTML en sortie.

Un contrôleur qui utilise le trait `RenderResponses` appelle `render()` avec un nom de gabarit et un tableau de variables. Le moteur sous-jacent est Latte par défaut, avec un moteur PHP simple comme solution de rechange.

## Rendre un gabarit

Montez un moteur sur le constructeur de l'application, puis rendez depuis un contrôleur :

```php
use Zephyrus\Controller\Controller;
use Zephyrus\Http\Response;
use Zephyrus\Rendering\RenderResponses;
use Zephyrus\Routing\Attribute\Get;

final class PageController extends Controller
{
    use RenderResponses;

    #[Get('/', name: 'home')]
    public function home(): Response
    {
        return $this->render('pages/home', ['name' => 'Ada', 'items' => ['one', 'two']]);
    }
}
```

`render('pages/home')` rend `app/Views/pages/home.latte`. Le nom est un chemin relatif au répertoire des vues, sans l'extension. Le troisième argument définit le code de statut, ce qui permet de répondre à un formulaire échoué avec une vue :

```php
return $this->render('contact', ['errors' => $errors->toArray()], 422);
```

`RenderResponses` donne trois méthodes à un contrôleur :

| Méthode | Ce qu'elle fait |
|---|---|
| `render($page, $args = [], $status = 200)` | Rend avec le moteur monté sur le constructeur. |
| `renderWith($engine, $page, $args = [], $status = 200)` | Rend avec un moteur que vous passez, en ignorant celui qui est monté. |
| `html($content, $status = 200)` | Retourne une réponse HTML à partir d'une chaîne que vous avez déjà. |

Sans moteur monté, `render()` lance une `RenderException`, et l'application répond 500. Montez-en un avec `withRenderEngine()` sur le constructeur (voir [Application](../application/)); il est injecté dans chaque contrôleur qui utilise le trait.

## Latte

`LatteEngine` est le moteur par défaut. Construisez-le à la main, ou à partir de la section de configuration `render:` (partie suivante) :

```php
use Zephyrus\Rendering\LatteEngine;

$views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
```

Ses arguments sont le répertoire des vues, le répertoire des gabarits compilés, un mode de cache et une liste d'extensions Latte. En mode de cache `always` (le défaut), les gabarits sont compilés une fois dans le répertoire de cache et recompilés lorsque le fichier source change. En mode `never`, rien n'est écrit sur le disque. Toute autre valeur est refusée à la construction du moteur. Le répertoire de cache est créé s'il n'existe pas.

Un gabarit est du HTML ordinaire avec des balises Latte :

```latte
{layout '../layouts/base.latte'}

{block title}Welcome, {$name}{/block}

{block content}
    <h1>Hello, {$name}</h1>
    <ul>
        {foreach $items as $item}
            <li>{$item}</li>
        {/foreach}
    </ul>
{/block}
```

[La documentation de Latte](https://latte.nette.org/en/tags) couvre l’ensemble du langage de balises. Voici celles que vous utiliserez en premier.

### Mises en page et blocs

Une mise en page déclare les blocs qu'une page peut remplir :

```latte
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{block title}My site{/block}</title>
    <link rel="stylesheet" href="{asset('/css/app.css')}">
</head>
<body>
    {include '../partials/nav.latte'}
    <main>
        {block content}{/block}
    </main>
</body>
</html>
```

Une page qui commence par `{layout '../layouts/base.latte'}` est rendue à l'intérieur de celle-ci, et ses balises `{block}` remplacent celles de la mise en page. Tout ce qui se trouve hors d'un bloc dans la page est ignoré.

Les fragments réutilisables viennent de `{include 'file.latte'}` pour un fichier, ou de `{define}` pour un fragment à l'intérieur du même gabarit :

```latte
{define badge $text}<span class="badge">{$text}</span>{/define}

{include badge 'new'}
```

### Chemins dans les mises en page et les inclusions

Un chemin dans `{layout}` ou `{include}` est relatif au gabarit qui le contient, non au répertoire des vues. Une mise en page dans `layouts/` qui inclut `partials/nav.latte` échoue avec `Missing template file '.../layouts/partials/nav.latte'` : écrivez `../partials/nav.latte`.

### Fonctions et filtres

Un gabarit Latte peut appeler n'importe quelle fonction PHP, et le framework fournit des assistants globaux prêts à l'emploi :

| Appel | Résultat |
|---|---|
| `{asset('/css/app.css')}` | Une URL avec invalidation du cache (voir [Ressources](#ressources)). |
| `{route('home')}` | L'URL d'une route nommée (voir [Routage](../routing/)). |
| `{=embed('/img/logo.svg')}` | Le contenu d'un fichier sous `public/` (voir [Ressources](#ressources)). |
| `{i18n('key')}` ou `{localize('key', ['name' => 'Ada'])}` | Une traduction (voir [Localisation](../localization/)). |
| `{nonce()}` | Le nonce Content-Security-Policy de la requête (voir [Content Security Policy](../../digging-deeper/content-security-policy/)). |

Les assistants de formatage deviennent des filtres Latte une fois que vous les enregistrez sur le moteur :

```php
$views->registerFormatterFilters(App::getFormatter());
```

Après cela, un gabarit peut écrire `{$total|money}`, `{$date|date}` ou `{$bytes|filesize}`. Les filtres sont `money`, `date`, `datetime`, `time`, `filesize`, `percent`, `decimal`, `timeago`, `duration`, `list`, `ordinal`, `spellOut` et `truncate`, plus chaque formateur que vous enregistrez avec `$formatter->register()`. Chacun est décrit dans [Localisation](../localization/). Le filtre `money` a besoin d'une devise, la configuration doit donc préciser laquelle :

```yaml
localization:
  locale: en_CA
  currency: CAD
```

Avec une locale qui n'a pas de devise native, comme `en`, le filtre lance `Currency required: locale "en" has no native currency...`. Avec la locale `en_CA` et la devise `CAD` ci-dessus, `{$total|money}` a affiché `$1,234.50`, `{$date|date}` a affiché `Mar 9, 2026` et `{$bytes|filesize}` a affiché `1.0 MB`.

`App::getFormatter()` retourne le formateur que `build()` installe, appelez donc `registerFormatterFilters()` après `build()`.

Pour ajouter une fonction ou un filtre bien à vous, ou toute autre extension Latte, utilisez le moteur sous-jacent :

```php
$views->getLatteEngine()->addFunction('csrfToken', $tokens->getToken(...));
$views->getLatteEngine()->addFilter('initials', fn (string $name): string => strtoupper($name[0]));
```

`addExtension()` sur `LatteEngine` enregistre une `Extension` Latte de la même façon. Le champ CSRF est documenté dans [Sécurité](../security/) : le formulaire a besoin de `{csrfToken()}` enregistré comme ci-dessus.

## Configurer le moteur

La section `render:` de `config.yml` décrit le moteur une seule fois. Les valeurs montrées sont les valeurs par défaut :

```yaml
render:
  engine: latte          # latte or php
  directory: app/Views
  cache: cache/latte
  mode: always           # always or never (Latte only)
  extension: .php        # file extension (PhpEngine only)
```

`render` n'est pas une section intégrée, alors enregistrez sa classe lorsque vous chargez la configuration, puis demandez-lui un moteur :

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Rendering\RenderConfig;

$config = Configuration::fromYamlFile($root . '/config.yml', ['render' => RenderConfig::class]);
$views = $config->section('render')->createEngine($root);
```

La section `render:` doit être présente dans `config.yml` : sans elle, `$config->section('render')` vaut `null` et `createEngine()` provoque une erreur fatale.

`createEngine()` prend la racine du projet et résout `directory` et `cache` relatifs par rapport à celle-ci; un chemin absolu est utilisé tel quel. Elle retourne un `LatteEngine` ou un `PhpEngine`, qui implémentent tous deux `RenderEngine`. Un nom de moteur inconnu lance une `RenderException` : `Unknown render engine [twig]. Supported engines: latte, php.`

## Le moteur PHP

`PhpEngine` rend des fichiers `.php`. Les variables sont extraites dans la portée du gabarit :

```php
use Zephyrus\Rendering\PhpEngine;

$engine = new PhpEngine($root . '/app/Views/php');
return $this->renderWith($engine, 'hello', ['name' => $name]);
```

```php
<h1>Hello, <?= e($name) ?></h1>
```

Le second argument du constructeur est l'extension de fichier, `.php` par défaut.

**Le moteur PHP n'échappe rien.** `<?= $name ?>` avec la valeur `<b>Ada</b>` affiche la balise comme du balisage. Passez chaque valeur qui aboutit dans le HTML par l'assistant global `e()`, qui échappe les guillemets aussi bien que les chevrons et remplace l'UTF-8 invalide au lieu de supprimer la valeur. Préférez Latte dès que le gabarit n'est pas trivial.

Les deux moteurs partagent l'interface `RenderEngine`, qui compte deux méthodes : `render(string $page, array $args = []): string` et `exists(string $page): bool`. Implémentez-la pour brancher un autre moteur.

## Échappement

Latte échappe selon le contexte où atterrit une valeur : texte HTML, attribut, URL, script. Avec `$comment = '<script>alert(1)</script>'` :

```latte
<p>{$comment}</p>
<input value="{$comment}">
```

affiche

```html
<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>
<input value="&lt;script&gt;alert(1)&lt;/script&gt;">
```

Une URL `javascript:` dans un `href` est remplacée par une valeur vide : `<a href="{$link}">` avec `javascript:alert(1)` a affiché `<a href="">`. L'échappement est le comportement par défaut, ce qui est la voie sûre. Voici les endroits où il cesse de vous protéger :

- `{$html|noescape}` affiche la valeur brute. Ne l'utilisez que sur du balisage que vous avez généré ou assaini vous-même, jamais sur une saisie utilisateur.
- `{=embed('/img/logo.svg')}` est échappé comme n'importe quelle autre valeur, de sorte que le fichier s'afficherait comme du texte. Un SVG que vous voulez en ligne demande `{=embed('/img/logo.svg')|noescape}`, et cela n'est sûr que pour les fichiers que vous livrez, puisque le fichier est affiché comme du balisage.
- L'échappement suit le balisage que Latte peut voir. À l'intérieur d'un élément `<script>`, `var user = {$user};` affiche un littéral JSON (un tableau contenant `</script><b>"x"` a affiché `{"name":"<\/script><b>\"x\""}`), ce qui est sûr. Construire du JavaScript ou un gestionnaire d'événement en ligne en concaténant des chaînes autour d'une valeur ne l'est pas : Latte échappe la valeur, pas le code que vous avez écrit autour.
- Dans le moteur PHP, rien n'est échappé : voir plus haut.

## Ressources

`Asset` transforme un chemin sous votre répertoire `public/` en une URL qui change lorsque le fichier change, de sorte que les navigateurs la gardent en cache tant qu'il reste identique. Enregistrez-le une seule fois, et l'assistant `asset()` (ainsi que `{asset()}` dans Latte) l'utilise :

```php
use Zephyrus\Core\App;
use Zephyrus\Rendering\Asset;

App::setAsset(new Asset($root . '/public'));
```

```latte
<link rel="stylesheet" href="{asset('/css/app.css')}">
```

affiche `<link rel="stylesheet" href="/css/app.css?v=145ccd37">`. La valeur `v` correspond aux 8 premiers caractères hexadécimaux du md5 du fichier. Le second argument du constructeur choisit un autre algorithme de hachage. La méthode derrière l'assistant est `$asset->url($path)`; elle est aussi appelable directement.

- Un fichier qui n'existe pas est retourné inchangé : `/css/none.css` reste `/css/none.css`.
- Un chemin qui contient déjà une chaîne de requête reçoit `&v=...` : `/css/app.css?x=1` devient `/css/app.css?x=1&v=145ccd37`.
- `embed($path)` retourne le contenu du fichier, ou une chaîne vide s'il est absent. `exists($path)` indique si le fichier est là.
- Le chemin est une entrée non fiable pour ce qui est de la classe : un segment `..`, un octet nul, ou un chemin qui se résout hors de `public/` (un lien symbolique, par exemple) est traité comme un fichier manquant.
- Sans `Asset` enregistré, `asset()` retourne le chemin tel que donné et `embed()` retourne une chaîne vide.

## Bon à savoir

- **Pas de moteur, pas de pages.** Un contrôleur qui rend sans moteur monté répond 500. `withRenderEngine()` couvre aussi les contrôleurs construits par une fabrique ou un conteneur.
- **Un échec de rendu est un 500.** Un gabarit manquant ou une erreur à l'intérieur de l'un d'eux lance `RenderException`, et le client voit `Internal Server Error`, jamais le message. `render()` sur une page manquante : `Template [pages/nope] not found.` Signalez-le avec un écouteur d'événements (voir [Erreurs](../errors/)).
- **Les noms de pages ne sont pas fiables.** Les deux moteurs refusent un nom contenant `..` ou un octet nul, ainsi qu'un fichier qui se résout hors du répertoire des vues. Malgré tout, ne construisez jamais un nom de page à partir d'un paramètre de requête.
- **`route()` a besoin du routeur.** L'appeler dans un gabarit rendu hors d'une application (un script en ligne de commande) lance une `LogicException` à moins que `App::setUrlGenerator()` n'ait été appelée.
- **Une faute de frappe dans `render:` est silencieuse.** La section ne fait pas partie des sections intégrées, donc `engin: php` est ignoré et Latte est utilisé. Vérifiez l'orthographe en vous référant à la liste ci-dessus.
- **Répertoire de cache.** Le répertoire `cache` doit être accessible en écriture au serveur web. Gardez-le hors de `public/`, et hors du contrôle de version.
