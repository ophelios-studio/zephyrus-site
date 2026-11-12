---
title: Localisation
order: 13
description: Traduisez du texte à partir de catalogues JSON, choisissez la langue d’une requête et formatez les montants, les nombres et les dates selon une locale.
---

# Localisation

Une autre langue. Un fichier JSON.

Zephyrus traduit à partir de catalogues JSON, choisit la locale d’une requête d’après l’en-tête `Accept-Language`, et formate les nombres, les montants et les dates avec l’extension `intl` de PHP. La traduction et le formatage sont deux services, `Translator` et `Formatter`, que `ApplicationBuilder::build()` installe pour vous.

## Configuration

```yaml
localization:
  locale: en_CA
  supported_locales: [en, fr]
  locale_path: locale
  timezone: America/Toronto
  currency: CAD
```

| Clé | Signification |
|---|---|
| `locale` | La locale par défaut (`en` par défaut). Elle est convertie en minuscules : `en_CA` est stockée sous la forme `en_ca`. |
| `supported_locales` | La liste d’autorisation utilisée lorsque la locale est choisie à partir d’une requête. Définissez-la toujours : une liste vide accepte n’importe quelle locale envoyée par le client. |
| `locale_path` | Le répertoire qui contient les catalogues. Un chemin relatif se résout à partir du `basePath` passé à `withConfiguration()`. |
| `timezone` | Appliqué avec `date_default_timezone_set()` lors de `build()` (`UTC` par défaut). |
| `currency` | Le code de devise que `money` utilise lorsqu’aucun n’est passé, sur trois lettres. |
| `date_format`, `time_format`, `datetime_format` | La valeur par défaut de `date`, `time` et `datetime` : un préréglage ICU (`short`, `medium`, `long`, `full`) ou un motif ICU tel que `yyyy-MM-dd HH:mm`. Valeurs par défaut : `medium`, `short`, `medium`. |
| `grouping_separator` | Le séparateur de milliers : `,`, `.`, `'`, une espace, U+00A0, U+202F ou U+2009. `''` désactive le regroupement, et il ne peut pas être le séparateur décimal de la locale. |

Une clé inconnue interrompt le démarrage, comme partout ailleurs dans la configuration. Chaque clé accepte son orthographe en snake_case ou en camelCase.

```php
$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->build();
```

`build()` crée un `Translator` et un `Formatter` pour la locale par défaut et les conserve pour les fonctions utilitaires ci-dessous.

## Catalogues

Un catalogue est un répertoire de fichiers JSON par langue. Chaque fichier `*.json` sous `locale/<language>/` est lu, fusionné en ordre alphabétique, et les objets imbriqués deviennent des clés séparées par des points :

```json
{
  "cart": {
    "title": "Your cart",
    "greeting": "Hello, {name|trim|title}!",
    "items": "{count} {count|plural:item:items}",
    "total": "Total: {amount|money}"
  }
}
```

Enregistré sous `locale/en/cart.json`, avec un `locale/fr/cart.json` français à côté. Ensuite :

```php
localize('cart.items', ['count' => 3]);          // "3 items"
localize('cart.total', ['amount' => 1234.5]);    // "Total: $1,234.50"
localize('cart.items', ['count' => 0], 'fr');    // "0 article"
localize('cart.missing');                        // "cart.missing"
```

`localize()` est la fonction globale (`i18n()` en est un alias). Son troisième argument impose une locale. Sinon, elle traduit pour la locale par défaut.

L’ordre de recherche pour une locale demandée telle que `fr-CA` est le suivant : `fr-CA`, puis `fr`, puis la locale par défaut, puis sa langue de base. Une clé introuvable dans chacune d’elles retourne la clé elle-même, de sorte qu’une traduction manquante apparaît sous forme de texte visible plutôt que d’une erreur. Une clé littérale contenant des points (`"cart.flat": "..."`) l’emporte sur le chemin imbriqué du même nom.

Une langue peut aussi tenir dans un seul fichier, `locale/en.json`, lorsque le répertoire est absent. Un catalogue manquant est vide. Un fichier illisible ou un JSON invalide lève une `LocalizationException` la première fois que cette locale est chargée.

### Paramètres et filtres

Un marqueur est `{name}`, ou `{name|pipe|pipe:argument}`. Les filtres s’appliquent de gauche à droite. Un marqueur sans paramètre correspondant reste tel qu’il est écrit.

| Filtre | Effet |
|---|---|
| `lower`, `upper`, `title` | changent la casse |
| `trim`, `ltrim`, `rtrim` | retirent les espaces blancs |
| `number:2:,:.` | `precision:thousands:decimal`, de sorte que `1234.567` devient `1,234.57` |
| `truncate:10:...` | coupe à une longueur, avec un suffixe facultatif (`…` par défaut) |
| `plural:item:items` | le mot correspondant au nombre, `item:items` (le mot seulement : écrivez vous-même le nombre). Sans seconde forme, un `s` est ajouté |
| `default:text` | le texte à utiliser lorsque la valeur est vide |
| `money`, `date`, `decimal`, ... | tout nom de `Formatter`, intégré ou enregistré |

Les formes plurielles suivent les règles de la locale : le français utilise donc le singulier pour `0` et `1`. Un filtre inconnu lève une `LocalizationException` qui énumère les filtres valides.

Les paramètres sont convertis en texte avant l’exécution des filtres : passez le nombre brut à un filtre `money`, et non une chaîne déjà formatée.

## La locale d’une requête

`localize()` utilise la locale par défaut. Pour répondre à un visiteur dans sa langue, résolvez la locale à partir de la requête, puis installez-y un traducteur et un formateur. Un middleware est l’endroit tout indiqué :

```php
use Zephyrus\Core\App;
use Zephyrus\Formatting\Formatter;
use Zephyrus\Http\MiddlewareInterface;
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Localization\JsonLocaleLoader;
use Zephyrus\Localization\LocaleResolver;
use Zephyrus\Localization\Translator;

final class LocaleMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly string $localePath)
    {
    }

    public function process(Request $request, callable $next): Response
    {
        $requested = $request->query('lang');

        $locale = (new LocaleResolver())->resolve(
            requestedLocale: is_string($requested) ? $requested : null,
            acceptLanguageHeader: $request->headers()->get('accept-language'),
            defaultLocale: 'en',
            supportedLocales: ['en', 'fr'],
        );

        App::setTranslator(new Translator(new JsonLocaleLoader($this->localePath), $locale));
        App::setFormatter(new Formatter($locale, 'CAD'));

        return $next($request->withAttribute('locale', $locale));
    }
}
```

Montez-le avec `withMiddleware()` (voir [Middleware](../middleware/)). Un contrôleur appelle ensuite `localize()` et `format()` comme d’habitude :

```php
return $this->json([
    'greeting' => localize('cart.greeting', ['name' => '  ada lovelace ']),
    'total' => localize('cart.total', ['amount' => 1234.5]),
]);
// Accept-Language: fr-CA,fr;q=0.9
// as displayed (json_encode escapes the non-breaking spaces as \u00a0 and \u202f):
// {"greeting":"Bonjour, Ada Lovelace !","total":"Total : 1 234,50 $CA"}
```

(Les espaces à l’intérieur du montant sont insécables.)

`LocaleResolver::resolve()` privilégie la valeur explicite (un segment d’URL, un témoin, un champ de formulaire), puis les candidats de `Accept-Language` selon leur qualité, puis la valeur par défaut. Un candidat est accepté lorsqu’il, ou sa langue de base, figure dans `supportedLocales` : `fr-CA,fr;q=0.9` face à `['en', 'fr']` donne `fr`, et `de` donne la valeur par défaut. La valeur explicite est vérifiée contre la même liste d’autorisation : avec `supportedLocales` définie, un visiteur ne peut donc pas choisir une locale de son invention. `AcceptLanguageResolver::resolve($header, $supported, $default, $requested)` applique la même logique sans la gestion des valeurs nulles.

Définissez à la fois le traducteur et le formateur. Un filtre `money` ou `date` dans une traduction utilise le `Formatter` de l’application, non la langue de la traduction : si seul le traducteur est changé, une phrase française affiche tout de même `$1,234.50`.

L’`Application` retournée par `build()` offre la même logique sous forme de deux méthodes, pour un script ou un test qui détient l’application : `$app->transFromRequest($key, $params, $request)` traduit dans la locale que demande la requête, et `$app->resolveLocaleFromRequest($request)` retourne cette locale (`null` lorsque vous ne passez ni requête ni locale).

## Chargeurs

`JsonLocaleLoader` est le chargeur par défaut, construit à partir de `locale_path`. Les chargeurs partagent `LocaleLoaderInterface` (`load(string $locale): array`), et deux d’entre eux en décorent un autre :

```php
use Zephyrus\Localization\CachedLocaleLoader;
use Zephyrus\Localization\FallbackLocaleLoader;
use Zephyrus\Localization\JsonLocaleLoader;

$loader = new CachedLocaleLoader(
    new FallbackLocaleLoader([
        new JsonLocaleLoader($root . '/vendor-locale'),   // base translations
        new JsonLocaleLoader($root . '/locale'),          // the application wins
    ]),
    debug: false,
    prefix: 'site',
    ttl: 3600,
);

$builder = $builder->withLocaleLoader($loader, defaultLocale: 'en');
```

- `FallbackLocaleLoader` fusionne plusieurs chargeurs clé par clé, le dernier l’emportant. Utilisez-le pour remplacer les traductions d’un paquet. `withJsonLocaleLayers([...paths])` et `withFallbackLoaders([...loaders])` le construisent pour vous.
- `CachedLocaleLoader` conserve les catalogues dans APCu lorsque l’extension est disponible et que `debug` vaut `false`, et lit directement depuis le chargeur interne dans le cas contraire. Appelez `flush()` après le déploiement de nouveaux fichiers de traduction.
- `withJsonLocales($path)`, `withLocaleLoader($loader, $default)`, `withSupportedLocales([...])` et `withLocalizationConfig($config, $basePath)` définissent les éléments que `withConfiguration()` définit à partir du YAML. Le dernier appel qui définit un chargeur l’emporte.

Écrivez le vôtre en implémentant l’interface (une base de données, une API), puis passez-le à `withLocaleLoader()`.

## Formatage

```php
format('money', 1234.5);                   // "$1,234.50"
format('date', new DateTimeImmutable('2026-03-09'));   // "Mar 9, 2026"
```

`format($name, ...$args)` est la fonction globale qui s’appuie sur le `Formatter` de l’application. Dans un script qui n’appelle jamais `build()`, appelez d’abord `App::setFormatter(new Formatter('en_CA', 'CAD'))`, sans quoi `format()` lève une `FormatterException`.

Un `Formatter` est construit à partir d’une locale et de valeurs par défaut facultatives, et s’utilise seul :

```php
use Zephyrus\Formatting\Formatter;

$en = new Formatter('en_CA', 'CAD');
$fr = new Formatter('fr_CA', 'CAD');
```

| Méthode | `en_CA` | `fr_CA` |
|---|---|---|
| `money(1234.5)` | `$1,234.50` | `1 234,50 $` |
| `money(10, 'EUR')` | `€10.00` | `10,00 €` |
| `decimal(1234.567)` | `1,234.57` | `1 234,57` |
| `percent(0.256, 1)` | `25.6%` | `25,6 %` |
| `ordinal(3)` | `3rd` | `3e` |
| `spellOut(42)` | `forty-two` | `quarante-deux` |
| `date($d)` | `Mar 9, 2026` | `9 mars 2026` |
| `date($d, 'yyyy-MM-dd')` | `2026-03-09` | `2026-03-09` |
| `time($d)` | `2:05 p.m.` | `14 h 05` |
| `datetime($d)` | `Mar 9, 2026, 2:05:00 p.m.` | `9 mars 2026, 14 h 05 min 00 s` |
| `timeago($d)` | `2 hours ago` | `il y a 2 heures` |
| `duration(7830)` | `2h 10m 30s` | `2 h 10 min 30 s` |
| `filesize(1536000)` | `1.5 MB` | `1,5 Mo` |
| `list(['a', 'b', 'c'])` | `a, b, and c` | `a, b et c` |
| `truncate('Hello world', 8)` | `Hello...` | `Hello...` |

(`$d` vaut `2026-03-09 14:05` dans le fuseau horaire par défaut. Les espaces dans les cellules françaises sont insécables, tout comme celle qui précède `p.m.` dans les cellules `time` et `datetime` de `en_CA` (U+202F).)

- `date`, `time` et `datetime` acceptent un `DateTimeInterface`, un horodatage Unix ou une chaîne de date, ainsi qu’un préréglage ou un motif ICU facultatif. Une valeur impossible à interpréter lève une `FormatterException`.
- `timeago`, `duration`, `filesize` et `list` sont rédigés en français pour une locale française et en anglais pour toute autre langue.
- `money` utilise, dans l’ordre, la devise que vous passez, la devise par défaut, puis la devise native de la locale. Une locale sans pays (`en`, `fr`) n’en a pas : passez une devise ou définissez `localization.currency`, sans quoi elle lève une exception.
- `list($items, 'disjunction')` joint avec « ou » au lieu de « et ».

Enregistrez votre propre formateur, accessible par `format('initials', ...)` et comme filtre de traduction :

```php
$en->register('initials', fn (string $name): string => implode('', array_map(
    fn (string $part): string => strtoupper($part[0]),
    explode(' ', $name),
)));

$en->format('initials', 'ada lovelace');   // "AL"
$en->has('initials');                      // true
```

Un nom inconnu lève une `FormatterException` qui énumère les noms intégrés. `getLocale()`, `getDefaultCurrency()` et les trois méthodes `getDefault...Pattern()` relisent les valeurs du constructeur.

## Dans les gabarits

`localize()` et `format()` sont de simples fonctions : un gabarit Latte peut donc les appeler. Les méthodes du formateur deviennent des filtres une fois enregistrées sur le moteur :

```php
$views = new LatteEngine($root . '/app/Views', $root . '/cache/latte');
$views->registerFormatterFilters(App::getFormatter());
```

```latte
<h1>{localize('cart.title')}</h1>
<p>{localize('cart.items', ['count' => $count])}</p>
<p>{$price|money} {$when|date} {$ratio|percent} {$size|filesize}</p>
```

Avec le formateur anglais, ceci produit `Your cart`, `2 items` et `$19.99 Mar 9, 2026 50% 2.0 KB`. Les filtres sont les noms de formateurs intégrés (`money`, `decimal`, `percent`, `ordinal`, `spellOut`, `date`, `time`, `datetime`, `timeago`, `duration`, `filesize`, `list`, `truncate`) ainsi que chaque formateur enregistré avant l’appel. Voyez [Vues](../views/) pour le reste du moteur de gabarits.

## Bon à savoir

- Une phrase traduite au milieu d’une requête qui utilise une autre locale exige à la fois `App::setTranslator()` et `App::setFormatter()`. L’un sans l’autre mélange les langues.
- `registerFormatterFilters()` lie le formateur que vous lui passez. Pour suivre un formateur qu’un middleware installe plus tard, passez une fermeture, appelée à chaque utilisation d’un filtre : `$views->registerFormatterFilters(fn () => App::getFormatter())`. Les noms de vos propres formateurs sont lus à l’enregistrement. En 0.14.0, seul un `Formatter` était accepté : un formateur ultérieur n’atteignait donc jamais les filtres.
- Une clé absente de la langue demandée se rabat silencieusement sur la langue par défaut. Gardez le catalogue par défaut complet, et comparez les listes de clés des autres dans un test.
- Passez toujours `supportedLocales` au résolveur : avec une liste vide, toute étiquette de langue bien formée est acceptée (une valeur mal formée, comme `../x` ou `fr!`, est ignorée) : c’est donc le visiteur qui choisit la locale. `JsonLocaleLoader` refuse tout ce qui n’est pas une étiquette de langue (le catalogue est alors vide), mais c’est la liste d’autorisation qui garantit que le choix vous appartient.
- `plural` affiche le mot, non le nombre : écrivez `{count} {count|plural:item:items}`.
- `localization.locale` est stockée en minuscules, et `supported_locales` aussi : `fr-CA` devient `fr-ca`, et les répertoires de catalogue nommés `fr-CA` ou `fr_CA` correspondent toujours.
