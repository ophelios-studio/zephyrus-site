---
title: Sessions
order: 9
description: Démarrez et configurez la session, lisez et écrivez ses données, renouvelez l’identifiant à la connexion, affichez des messages éphémères et stockez les sessions dans PostgreSQL.
---

# Sessions

L’état qui suit un visiteur.

`SessionMiddleware` démarre la session avant l’exécution de votre contrôleur. À partir de là, vous la lisez et l’écrivez par l’entremise d’un `SessionManager`, et le navigateur ne conserve qu’un identifiant opaque dans un témoin (cookie).

## Monter le middleware

```php
use Zephyrus\Session\SessionCsrfTokenManager;
use Zephyrus\Session\SessionManager;
use Zephyrus\Session\SessionMiddleware;

$session = new SessionManager();
$tokens = new SessionCsrfTokenManager($session);

$app = ApplicationBuilder::create()
    ->withConfiguration($config, basePath: $root)
    ->withRouter($router)
    ->withMiddleware(new SessionMiddleware($config->session, $session))
    ->withMiddleware(new CsrfMiddleware($tokens, CsrfConfig::fromSecurityConfig($config->security)))
    ->build();
```

Le middleware démarre la session avec les réglages de témoin de la section `session:`, enregistre le gestionnaire pour le helper `session()` et pour `Flash`, puis le place sur la requête sous l’attribut `session`. C’est un middleware global : il s’exécute donc aussi sur les réponses 404, et une requête qui ne correspond à aucune route ouvre quand même une session. Enregistrez avant lui les middlewares capables de refuser une requête (`ForceHttpsMiddleware`, `AllowedHostsMiddleware`), de sorte qu’une requête refusée ne reçoive jamais de témoin. Voir [Middleware](../middleware/).

Montez-le **avant** `CsrfMiddleware` : le jeton vit dans la session. Le gestionnaire de jetons adossé à la session et la protection CSRF elle-même sont décrits sur [Sécurité](../security/).

Sans `SessionMiddleware`, les écritures `session([...])` et les messages flash sont abandonnés en silence, et `$request->attribute('session')` vaut `null`.

## Lire et écrire

Dans un contrôleur, prenez le gestionnaire sur la requête :

```php
use Zephyrus\Session\SessionManager;

#[Post('/visit')]
public function visit(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');
    $session->set('visits', $session->get('visits', 0) + 1);

    return $this->json(['visits' => $session->get('visits')]);
}
```

Deux requêtes avec le même témoin ont affiché `{"visits":1}` puis `{"visits":2}`. Le gestionnaire :

| Méthode | Ce qu’elle fait |
|---|---|
| `get($key, $default = null)` | La valeur, ou la valeur par défaut quand la clé est absente. |
| `set($key, $value)` | Stocke une valeur. Lance `SessionException` quand aucune session n’est active. |
| `has($key)` | Indique si la clé existe, même quand sa valeur est `null`. |
| `remove($key)` | Supprime une clé. Il ne se passe rien quand la session a été lue et ne la contient pas. |
| `all()` | Toutes les clés et toutes les valeurs. |
| `flash($key, $default = null)` | Lit une valeur et la supprime dans le même appel. |
| `id()` | L’identifiant de session, `''` quand aucune session ne tourne. |
| `isStarted()` | Indique si une session est active. |

Les clés sont des chaînes non vides ; une clé vide lance `SessionException`. Tout ce que PHP sait sérialiser peut être stocké, mais stockez des identifiants et de petites valeurs, pas des entités ni de gros tableaux.

Le helper `session()` lit et écrit par l’entremise du gestionnaire enregistré : `session('visits', 0)` lit, `session(['visits' => 3])` écrit. Il est pratique dans un gabarit, et `$request->attribute('session')` est plus clair dans un contrôleur.

### Renouveler l’identifiant à la connexion

Un identifiant de session valide avant une connexion ne doit pas le rester après, sinon la personne qui a imposé cet identifiant conserve la session authentifiée. Après avoir vérifié les identifiants, renouvelez l’identifiant de session, renouvelez le jeton CSRF, et seulement ensuite stockez l’utilisateur :

```php
use Zephyrus\Session\Flash;
use Zephyrus\Session\SessionCsrfTokenManager;

#[Post('/sign-in')]
public function signIn(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');

    // ...check the credentials first, then:
    $session->regenerate();
    (new SessionCsrfTokenManager($session))->regenerate();
    $session->set('user_id', 42);
    Flash::success('Welcome back.');

    return Response::redirect('/me');
}
```

`regenerate()` émet un nouvel identifiant et supprime les anciennes données de session (`regenerate(false)` les conserve). À l’exécution, le témoin est passé de `84201137...` à `056c96de...` dans la réponse de connexion, et le jeton de formulaire obtenu avant la connexion a été refusé ensuite par un 403 : c’est la deuxième ligne qui fait son travail. `new SessionCsrfTokenManager($session)` partage son jeton avec celui de votre bootstrap ; si le bootstrap a passé une clé de session personnalisée en second argument, passez la même ici.

### Détruire à la déconnexion

```php
#[Post('/sign-out')]
public function signOut(Request $request): Response
{
    /** @var SessionManager $session */
    $session = $request->attribute('session');
    $session->destroy();

    return Response::redirect('/');
}
```

`destroy()` vide la session et la supprime du magasin. Elle lance `SessionException` quand le magasin refuse, de sorte qu’une déconnexion ne signale jamais un succès pendant que les données survivent. Interceptez l’exception là où une solution de repli doit tout de même s’exécuter. Le navigateur garde son témoin, mais l’identifiant ne correspond plus à rien : la requête suivante démarre une nouvelle session. Une déconnexion est un changement d’état : faites-en une requête `POST` derrière le middleware CSRF, jamais un lien.

## Messages flash

Un message flash vit jusqu’à la prochaine lecture, ce qui en fait le moyen de dire quelque chose à travers une redirection :

```php
use Zephyrus\Session\Flash;

Flash::success('Saved.');                  // before the redirect
$flash = Flash::readAll();                 // after it
// $flash->success, ->error, ->warning, ->info: lists of strings
```

`Flash::success()`, `error()`, `warning()` et `info()` acceptent chacune une chaîne ou une liste de chaînes et s’ajoutent à ce qui est déjà stocké. `readAll()` retourne un objet contenant les quatre listes et les vide. `Flash::clearAll()` vide sans lire. Après `Flash::success('Saved.')` et `Flash::error(['a', 'b'])`, `readAll()` a retourné `{"success":["Saved."],"error":["a","b"],"warning":[],"info":[]}` et un deuxième appel a retourné quatre listes vides.

Lisez les messages dans le contrôleur qui affiche la page et passez-les à la vue :

```php
return $this->render('contact', ['flash' => Flash::readAll()]);
```

```latte
{foreach $flash->success as $message}<p role="status">{$message}</p>{/foreach}
```

Les messages flash contiennent souvent des données saisies par l’utilisateur. Latte les échappe ; le moteur PHP ne le fait pas, enveloppez-les donc avec `e()` dans ce cas (voir [Vues](../views/)).

## Configurer le témoin

La section `session:` contrôle le témoin. Les valeurs affichées sont les valeurs par défaut :

```yaml
session:
  name: PHPSESSID       # the cookie name
  lifetime: 0           # seconds; 0 is a browser-session cookie
  http_only: true       # scripts cannot read the cookie
  secure: auto          # true, false or auto
  same_site: Lax        # Strict, Lax or None
  cookie_path: /
  idle_timeout: null    # seconds of inactivity, DatabaseSessionHandler only
```

`SessionConfig` est l’objet typé qui s’y rattache, accessible par `$config->session`. Les clés peuvent s’écrire en snake_case ou en camelCase, mais une seule graphie par clé. Une clé inconnue, ou mal orthographiée, empêche le démarrage : `Configuration section 'session' field 'lifetim' is an unknown key: did you mean "lifetime"?`

- **`secure: auto`** ajoute l’attribut `Secure` sur les requêtes HTTPS et l’omet en HTTP simple, ce qui permet au développement local de continuer à fonctionner. À l’exécution, en HTTP simple, le témoin était `PHPSESSID=...; path=/; HttpOnly; SameSite=Lax`. Réglez `secure: true` en production pour que le témoin ne soit jamais envoyé en HTTP. `secure: false` ne l’ajoute jamais. Derrière un mandataire qui termine TLS, `auto` ne voit du HTTPS que si le mandataire figure dans `security.trustedProxies`.
- **`http_only: true`** tient JavaScript à l’écart du témoin. Laissez-le activé.
- **`same_site: Lax`** envoie le témoin lors des navigations de premier niveau, mais pas sur les requêtes intersites qui soumettent des formulaires ou chargent des ressources. `Strict` le retient aussi quand un visiteur arrive depuis un autre site. `None` exige `Secure`.
- **Aucun attribut `Domain`** n’est jamais défini : le témoin appartient à l’hôte exact qui l’a émis.
- **`lifetime`** est la durée de vie du témoin en secondes. Elle ne raccourcit pas la session côté serveur.
- **`idle_timeout`** est appliqué à la lecture par `DatabaseSessionHandler`. Avec le gestionnaire de fichiers de PHP, ce n’est qu’un âge de nettoyage : rien ne vérifie depuis combien de temps la session était inactive lors de sa lecture. En mode débogage, le framework émet un avertissement à ce sujet.

Les combinaisons qu’un navigateur ignorerait en silence sont refusées au démarrage : `SameSite=None` sans `Secure`, un nom `__Host-` avec un chemin autre que `/`, un nom `__Secure-` ou `__Host-` qui ne pourra jamais être `Secure`. Par exemple, `same_site: None` avec `secure: false` échoue avec `... requires secure to be true or auto: browsers discard a SameSite=None cookie without Secure.`

## Stocker les sessions dans PostgreSQL

Par défaut, PHP conserve les sessions dans des fichiers. Pour partager les sessions entre plusieurs serveurs, ou pour appliquer `idle_timeout`, stockez-les dans PostgreSQL. Créez la table une seule fois :

```sql
CREATE TABLE public.session (
    session_id VARCHAR PRIMARY KEY,
    access     INTEGER NOT NULL,
    expire     INTEGER NOT NULL,
    data       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX session_access_idx ON public.session (access);
```

Enregistrez ensuite le gestionnaire sur le `SessionManager`, avant `build()` :

```php
use Zephyrus\Data\Database;
use Zephyrus\Session\DatabaseSessionHandler;

$session = new SessionManager();
$session->setHandler(new DatabaseSessionHandler(
    fn (): Database => Database::fromConfig($config->database),
));
```

La fonction anonyme (closure) retarde la connexion jusqu’à la première lecture de la session. Vous pouvez passer une `Database` à la place. Par défaut, le gestionnaire écrit dans `public.session` ; ses deuxième à quatrième arguments définissent un autre nom de table, un autre nom de colonne d’identifiant et un autre motif d’identifiant. `setHandler()` doit s’exécuter avant le démarrage de la session, et lance `SessionException` quand PHP le refuse.

Après une visite qui a stocké `visits`, la table contenait une ligne dont `data` valait `_csrf_token|s:64:"...";visits|i:1;`. Les données suivent la sérialisation de session de PHP, conservée sous forme de texte. Les contenus qui ne sont pas de l’UTF-8 valide sont stockés encodés en base64 : ne cherchez donc pas dans `data` avec `LIKE`.

À savoir au sujet de ce gestionnaire :

- **Il applique le délai d’inactivité.** Une ligne dont `expire` est dépassé, ou inactive depuis plus longtemps que `idle_timeout`, n’est ni reprise ni lue.
- **Une nouvelle session vide n’est pas stockée.** Un visiteur anonyme qui n’écrit jamais rien reçoit un nouveau témoin à chaque requête, jusqu’à ce que quelque chose soit stocké dans la session (le jeton CSRF compte).
- **Fermez, régénérez ou détruisez en dehors d’une transaction de base de données** sur la même connexion : une écriture de session qui échoue annule la transaction, et le verrou reste tenu jusqu’à la fermeture de la connexion.
- **Il active lui-même le mode strict** (`session.use_strict_mode`), de sorte qu’un identifiant inventé par le client n’est pas adopté. `SessionManager::start()` fait de même pour n’importe quel gestionnaire.

### Verrouillage de session

Deux requêtes d’un même visiteur peuvent s’exécuter au même moment : une page et un appel AJAX, par exemple. Sans protection, les deux lisent la session, les deux l’écrivent, et la dernière écriture efface la première. `DatabaseSessionHandler` prend donc un verrou consultatif (advisory lock) PostgreSQL sur l’identifiant de session à la lecture, et le libère à la fermeture de la session. La deuxième requête attend (jusqu’à cinq secondes, puis continue sans le verrou plutôt que de se bloquer) que la première ait terminé.

Une route qui lit `visits`, attend une seconde et écrit `visits + 1`, appelée deux fois en parallèle avec le même témoin à partir d’un compte de 1, s’est terminée à 3 avec le verrou. Avec `lockSessions: false`, les deux appels ont répondu `{"visits":2}` : une mise à jour a été perdue.

Le verrou a un coût : une requête lente bloque les autres du même visiteur. Terminez donc tôt le travail qui n’a pas besoin de la session, ou évitez les longues requêtes qui la retiennent. Ne passez `lockSessions: false` que derrière PgBouncer en mode de regroupement par transaction ou par instruction, où le verrou resterait sur une connexion serveur après la requête :

```php
new DatabaseSessionHandler($open, lockSessions: false);
```

Sans le verrou (`lockSessions: false`, ou une attente qui a dépassé cinq secondes), le gestionnaire ne laisse plus la dernière écriture écraser la précédente. Il n’écrit une session reprise que tant que sa ligne contient encore les données lues par cette requête : si une autre requête a modifié ou supprimé la ligne entre-temps, l’écriture est refusée, rien n’est enregistré et l’application ne voit aucune exception. `write()` retourne `false`, ce que PHP signale par un avertissement, et le gestionnaire journalise `Zephyrus: session write refused, the session changed or was deleted since this request read it`. Les modifications de session de cette requête sont perdues : gardez donc les écritures de session courtes et idempotentes là où le verrou est désactivé. La version 0.14.1 laissait la dernière écriture l’emporter.

Avec le gestionnaire de fichiers, PHP verrouille le fichier de session pendant toute la requête, avec le même effet.

## Tester le code qui utilise la session

`new SessionManager([])` garde tout dans le tableau que vous passez plutôt que dans la session de PHP, avec un identifiant simulé. Il est destiné aux tests et aux scripts en ligne de commande (voir [Tests](../../digging-deeper/testing/)) :

La classe de bootstrap de [L’application](../application/) construit son propre `SessionManager`. Pour lui passer le vôtre, donnez à `Kernel::application()` un troisième argument optionnel et recourez à un vrai gestionnaire par défaut :

```php
public static function application(string $root, Configuration $config, ?SessionManager $session = null): Application
{
    $session ??= new SessionManager();
    $tokens = new SessionCsrfTokenManager($session);

    // ...the rest of the method is unchanged: the same $session feeds
    // SessionMiddleware and the CSRF token manager.
}
```

Un test passe alors le sien :

```php
$session = new SessionManager([]);
$application = Kernel::application($root, $config, $session);
```

Dans ce mode, `start()` ne fait rien et `isStarted()` vaut toujours `true`. `regenerate()` donne un nouvel identifiant simulé et conserve les données, tandis que `destroy()` efface les données et fixe l’identifiant à une chaîne vide.

## À savoir

- **Sans middleware, perte silencieuse.** Sans `SessionMiddleware`, les messages flash et les écritures `session([...])` sont abandonnés sans erreur.
- **Une écriture exige une session active.** `set()` sur un vrai gestionnaire jamais démarré lance `SessionException` : `Cannot write "a" to the session: no session is active. Run SessionMiddleware on this route, or call start(); in a test, pass an array to new SessionManager([]).`
- **Renouvelez toujours lors d’un changement de privilèges.** Appelez `regenerate()` et le `regenerate()` du gestionnaire de jetons à la connexion, et de nouveau quand un utilisateur obtient de nouveaux droits.
- **Ne stockez pas l’utilisateur complet.** Stockez l’identifiant et chargez l’utilisateur à chaque requête, pour qu’un rôle modifié prenne effet immédiatement.
