---
title: Data access
order: 12
description: Connect to PostgreSQL, run parameterised queries and transactions, hydrate entities, and build paginated, sorted and filtered listings from request input.
---

# Data access

Your SQL. Your data model.

Zephyrus talks to PostgreSQL through `Zephyrus\Data\Database`, a thin layer over PDO. You write the SQL, the framework binds the parameters, converts the column types and reports failures. There is no query builder and no ORM: a query is a string you can read.

## Connecting

Add a `database:` section to `config.yml`. Secrets come from the environment with `!env`, never from the file:

```yaml
database:
  host: !env DB_HOST, localhost
  port: !env DB_PORT, 5432
  database: !env DB_NAME, app
  username: !env DB_USERNAME, app
  password: !env DB_PASSWORD
```

`database` and `username` are required. The other keys are `driver` (only `pgsql`), `charset` (default `utf8`), `ssl_mode` (`disable`, `allow`, `prefer`, `require`, `verify-ca` or `verify-full`), `ssl_root_cert`, `column_cache_version` and `persistent` (see [persistent connections](#persistent-connections)). Any other key stops the boot with the closest accepted spelling. The section is parsed into a `DatabaseConfig`, available as `$config->database` (`null` when the section is absent).

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Data\Database;

$config = Configuration::fromYamlFile($root . '/config.yml');
$db = Database::fromConfig($config->database);
```

`fromConfig()` opens the connection with `PDO::connect()`, so `$db->pdo()` is a `Pdo\Pgsql`, and with server-side prepared statements: the SQL and the values always travel separately, and this cannot be turned off. On PostgreSQL each query also goes out as an unnamed statement (`Pdo\Pgsql::ATTR_DISABLE_PREPARES`, set after connecting): one round trip instead of three (prepare, execute, close), with the parameters still bound by the server and never emulated. Version 0.14.1 prepared a named statement per query. To get named statements back, call `$db->pdo()->setAttribute(\Pdo\Pgsql::ATTR_DISABLE_PREPARES, false)`. A failed connection throws a `DatabaseException` that names the DSN (host, port, database, never the password) and the driver reason: log it, do not show it.

`Database` is not created for you. Build it once and hand it to your brokers, or register it in the [container](../../digging-deeper/container-and-events/) so controllers and brokers receive it by their constructor:

```php
use Zephyrus\Container\Container;

$container = new Container();
$container->singleton(Database::class, static fn (): Database => Database::fromConfig($config->database));

$builder = $builder->withContainer($container);
```

### Persistent connections

`persistent: true` keeps one connection per PHP process and hands it to the next `fromConfig()` of that process, which saves the cost of a new connection on every request. It is `false` by default, and `!env` works (`persistent: !env DB_PERSISTENT, false`).

Each time `fromConfig()` takes the connection back, it sends `ROLLBACK` if a transaction is still open, then `DISCARD ALL`, and drops the notifications already received, so settings, `SET ROLE`, session advisory locks, temporary tables and prepared statements never reach the next request. One trace remains: a custom setting the previous holder set reads `''` instead of `NULL`, which is why a policy reads `nullif(current_setting('app.actor_id', true), '')`. A connection whose reset fails is closed and replaced once; a second failure throws a `DatabaseException`.

- While a `Database` built from the persistent connection is alive, another `fromConfig()` with the same settings opens a regular connection instead, so a session is never reset under its holder. Share one `Database` per request.
- Each process holds its connection as long as it lives: PostgreSQL's `max_connections` must cover every PHP-FPM or Apache process of every server, plus your command-line scripts.
- A connection factory sets no session state: with `persistent: true` it runs before the reset, which erases it. Set session state after `fromConfig()` returns.
- On PHP 8.5, a factory of your own used with `persistent: true` builds the connection with `PDO::connect()`, as the default one does, or each reuse emits a deprecation.

Persistence goes through this key only. `new Database($pdo)` refuses a PDO opened with `PDO::ATTR_PERSISTENT`, and `fromConfig()` refuses a connection factory that returns one while `persistent` is `false`, because the session of such a connection would carry over from an earlier request unchanged:

```text
Zephyrus\Data\DatabaseException: Database refuses a persistent PDO, whose session would carry over from an earlier request: remove PDO::ATTR_PERSISTENT from the PDO and set database.persistent: true in the configuration, so Database::fromConfig() resets the session each time it reuses the connection.
```

## Running queries

The examples on this page use these tables:

```sql
CREATE TABLE project (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active',
    budget numeric(20, 2) NOT NULL DEFAULT 0,
    tags text[] NOT NULL DEFAULT '{}',
    meta jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    total numeric(12, 2) NOT NULL
);

CREATE TABLE order_line (
    order_id bigint NOT NULL REFERENCES orders (id),
    sku text NOT NULL
);

CREATE TABLE blob (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    digest bytea NOT NULL
);
```

Placeholders are positional (`?`) or named (`:name`), never mixed in one statement. Values are always bound, never concatenated:

```php
$project = $db->selectOne('SELECT id, name FROM project WHERE id = ?', [$id]);
$rows = $db->select('SELECT id, name FROM project WHERE status = :status', ['status' => 'active']);
```

Rows are `stdClass` objects. These methods read:

| Method | Returns |
|---|---|
| `select($sql, $params)` | every row, as a list |
| `selectOne(...)` | the first row, or `null` |
| `selectValue(..., $default)` | the first column of the first row, or `$default` |
| `selectInt`, `selectString`, `selectBool`, `selectFloat` | the same value cast to a type, or the default (`0`, `null`, `false`, `0.0`) |
| `count($sql, $params)` | an `int` from a `SELECT count(*)` |
| `exists($sql, $params)` | `true` when the first column is truthy |

These write, and return the number of affected rows:

| Method | Use |
|---|---|
| `execute`, `insert`, `update`, `delete` | the same call under four names, for readability |
| `insertGetId($sql, $params)` | an `INSERT ... RETURNING id`, returning the id as a string (or `false` when no row came back) |

```php
$id = (int) $db->insertGetId(
    'INSERT INTO project (name, budget) VALUES (?, ?) RETURNING id',
    ['Alpha', '1200.00'],
);
$db->update('UPDATE project SET archived = ? WHERE id = ?', [true, $id]);
```

On PostgreSQL the id comes back through `RETURNING` only. `insertGetId()` refuses a statement without it, and `lastInsertId()` is refused, because it can name another table's sequence.

Parameters are bound by type: `null`, integers, floats, strings, booleans, `DateTimeInterface`, `BackedEnum` (its backing value), `Stringable`, `Binary` and streams. An array has no SQL form and throws an `InvalidArgumentException`: see [PostgreSQL types](#postgresql-types) for lists. Each call runs one statement: `"INSERT ...; INSERT ..."` fails and inserts nothing.

`query()` returns the raw `PDOStatement` and `pdo()` the connection, for the rare case the helpers do not cover. A statement run through `pdo()` is not tracked by `transaction()`.

`new Database($pdo)` wraps a PDO connection you opened yourself (a test database, for instance): it forces exceptions, object rows and server-side prepares on it, and leaves named statements as they are. `inTransaction()` tells whether a transaction is open right now; do not cache the answer.

### Column type cache

Rows are decoded from the column types PostgreSQL reports. Those types are cached per SQL text and result width, in the process and in APCu when it is installed. Only a statement whose first element, after blanks and comments, is a parenthesis or `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` or `MERGE` uses the cache (a block comment that contains another is not skipped). Any other statement (`FETCH`, `EXECUTE`, `SHOW`, `CALL`) describes its columns on every call, one to two round trips per column, so fetch in large batches. Version 0.14.1 let a `FETCH` on a second cursor of the same width inherit the converters of the first, and its `jsonb` columns came back as strings.

A column that changes type while keeping its name and the width of the result keeps its old converter, so a `jsonb` column comes back as a string. Set `column_cache_version` in the `database` section to a value that changes with every migration, and the stale shape is dropped:

```yaml
database:
  column_cache_version: !env DB_SCHEMA_VERSION
```

Change the value after the migration has run and before the release serves traffic. Without it, a stale shape lives up to an hour under PHP-FPM with APCu, only the current request under PHP-FPM without APCu, and until the process restarts or `Database::flushSharedColumnMetadata()` runs in a long-running process (command line, RoadRunner).

## Transactions

`transaction()` runs a callback, commits when it returns and rolls back when it throws. The callback receives the `Database`, and its return value is returned:

```php
$orderId = $db->transaction(function (Database $db): int {
    $id = (int) $db->insertGetId('INSERT INTO orders (total) VALUES (?) RETURNING id', ['40.00']);
    $db->insert('INSERT INTO order_line (order_id, sku) VALUES (?, ?)', [$id, 'A-100']);

    return $id;
});
```

Called inside an open transaction, `transaction()` opens a savepoint: a failure undoes only the inner writes, and an exception caught outside the inner call leaves the outer work intact.

Do not catch a failed statement inside the callback and carry on. PostgreSQL aborts the transaction at the first error, so the commit would silently become a rollback. The framework detects it and throws a `DatabaseException` (SQLSTATE `25P02`) instead of reporting success. Let the exception propagate, or catch it around a nested `transaction()`.

## Row level security

PostgreSQL row level security filters rows inside the database, with policies that read who is acting from a setting. `Zephyrus\Data\DatabaseActor` publishes that actor for one transaction only (`set_config(..., true)`), so it never reaches the next request, the next holder of a [persistent connection](#persistent-connections), or another client behind a pooler in transaction mode.

A policy reads the setting with `nullif(..., '')`, since an unset setting can read as an empty string:

```sql
ALTER TABLE project ADD COLUMN owner_id bigint;
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_owner ON project
    USING (owner_id = nullif(current_setting('app.actor_id', true), '')::bigint);
```

**Publishing protects nothing by itself.** A superuser, a role with `BYPASSRLS` and the owner of a table without `ALTER TABLE ... FORCE ROW LEVEL SECURITY` see every row whatever the actor. Connect as a role the policies apply to.

The constructor takes the `Database`, a prefix and the keys your policies read: `['actor_id']` under `app` declares the setting `app.actor_id`. `actAs()` opens a transaction, publishes the values, runs the callback (which receives the `Database`) and commits; the actor ends with the transaction:

```php
use Zephyrus\Data\Database;
use Zephyrus\Data\DatabaseActor;

$actor = new DatabaseActor($db, 'app', ['actor_id']);

$projects = $actor->actAs(['actor_id' => (string) $userId], function (Database $db): array {
    return $db->select('SELECT id, name FROM project ORDER BY id');
});
```

With projects owned by users 7 and 8, the call for user 7 returns only user 7's project, and the same `SELECT` run after `actAs()` returns no row. In a middleware, `return $actor->actAs([...], fn (): Response => $next($request));` runs the rest of the request in that one transaction.

Inside a transaction you already opened, `publish()` sets the actor until the outermost transaction ends (a savepoint rolled back takes it back):

```php
$db->transaction(function (Database $db) use ($actor, $userId, $id): void {
    $actor->publish(['actor_id' => (string) $userId]);
    $db->update('UPDATE project SET name = ? WHERE id = ?', ['Alpha 2', $id]);
});
```

Values are non-empty strings, for declared keys only. Every refusal is a `DatabaseActorException`, and its message never holds a value:

| Call | Refusal |
|---|---|
| `actAs(['actor_id' => 7], ...)` | `The actor value for "actor_id" must be a string, int given: cast it first, such as (string) $userId.` |
| `actAs(['actor_id' => ''], ...)` | `The actor value for "actor_id" must be a non-empty string, an empty string given: an empty value reads as no actor, so leave the key out instead.` |
| `actAs(['org_id' => '3'], ...)` | `The actor values key "org_id" names no declared key (declared: "actor_id").` |
| `actAs()` inside `transaction()` | `DatabaseActor::actAs() opens its own transaction and refuses one already open, where the actor would outlive the callback until that transaction ends: call actAs() outside any transaction, or publish() inside the open one.` |
| `publish()` outside a transaction | `DatabaseActor::publish() needs an open transaction: outside one, PostgreSQL drops the actor before the next statement. Use actAs(), or call publish() inside Database::transaction().` |
| a second actor in the same transaction | `An actor is already published on this connection ("app.actor_id" is set): an actor changes only by ending its transaction, and a value set for the whole session is refused.` |

The constructor refuses a connection other than PostgreSQL, and a prefix or key that is not 1 to 63 lowercase letters, digits and underscores, not starting with a digit (`The actor key "Actor-Id" is not a valid setting name: use 1 to 63 lowercase letters, digits and underscores, not starting with a digit.`).

- **Without an actor**, a `SELECT` under these policies returns no row and an `INSERT` is refused, but an `UPDATE` or a `DELETE` touches 0 rows without an error: check the count it returns.
- **The actor changes only when its transaction ends.** A value set for the whole session with `set_config(..., false)` is refused the same way, on any declared key. Two identities in one flow are two keys of one actor, published together.
- **Declare every key your policies read in one instance.** The refusal of a second actor covers the keys that instance declares: two instances with different keys on the same `Database` can each publish one, and the actors stack.
- **Inside `actAs()`, every `transaction()` is a savepoint** and the commit happens when `actAs()` returns. Send an email or any other effect that must follow the commit after `actAs()` has returned.
- **Choose a prefix of your own**, such as `app`, never `plpgsql`.

## PostgreSQL types

Rows come back converted: integers, floats and booleans as PHP scalars, PostgreSQL arrays as PHP arrays, `json` and `jsonb` decoded (objects as `stdClass`), timestamps and dates as strings.

**Arrays.** Reading is automatic. Writing takes a PostgreSQL array literal with a cast, which keeps the value a single bound parameter:

```php
$db->insert('INSERT INTO project (name, tags) VALUES (?, ?::text[])', ['Gamma', '{"php","sql"}']);
$rows = $db->select('SELECT id, name FROM project WHERE id = ANY(?::bigint[])', ['{1,2,3}']);
$row = $db->selectOne('SELECT tags FROM project WHERE name = ?', ['Gamma']);
// $row->tags === ['php', 'sql']
```

Build the literal yourself with each element double-quoted and `"` and `\` escaped (a small private helper in the broker is enough).

**JSON.** Bind `json_encode()` output with a cast, read it back decoded:

```php
$db->execute('UPDATE project SET meta = ?::jsonb WHERE id = ?', [json_encode(['owner' => 'ada']), $id]);
// selectOne('SELECT meta ...')->meta->owner === 'ada'
```

**Binary data.** Wrap bytes in `Binary` to write a `bytea` column. A `bytea` column is read back as a stream, not a string:

```php
use Zephyrus\Data\Binary;

$id = $db->insertGetId('INSERT INTO blob (digest) VALUES (?) RETURNING id', [new Binary(hash('sha256', 'hello', true))]);
$bytes = stream_get_contents($db->selectOne('SELECT digest FROM blob WHERE id = ?', [$id])->digest);
```

**Exact numbers.** `NUMERIC` and `DECIMAL` columns become PHP floats, which loses digits on large amounts. For money, register a passthrough so the value stays the exact string PostgreSQL sent:

```php
$db->registerTypeConversion('NUMERIC', static fn (string $value): string => $value);
// 12345678901234567.89 stays '12345678901234567.89'
```

Register it right after creating the `Database`. Converters are keyed by the PostgreSQL type name and receive the raw string.

## Brokers, services and entities

Applications built on Zephyrus usually split data code in three, typically under `app/Models/<Domain>/{Brokers,Services,Entities}`. Only `Broker` and `Entity` are framework classes; the split itself is a convention.

A **broker** holds the SQL of one domain. It extends `Zephyrus\Data\Broker`, receives the `Database` and exposes the query methods as protected helpers (`select`, `selectOne`, `selectValue`, `selectInt`, `selectString`, `selectBool`, `selectFloat`, `selectCount`, `exists`, `selectPage`, the other pagination methods, `execute`, `transaction`). `selectString()`, `selectBool()` and `selectFloat()` read the first column of the first row as a `?string`, a `bool` or a `float` (with a default), and `selectPage($sql, $page, $perPage, $params)` returns one page of rows as a list. `execute()` runs any statement and returns the affected row count. `lastInsertId()` is also there, and refused on PostgreSQL like its `Database` twin. Writes are named `insertRow`, `insertRowGetId`, `updateRows` and `deleteRows`, so they do not collide with your own method names:

```php
namespace App\Models\Project\Brokers;

use Zephyrus\Data\Broker;

final class ProjectBroker extends Broker
{
    public function findById(int $id): ?\stdClass
    {
        return $this->selectOne(
            'SELECT id, name, status, budget, tags, meta FROM project WHERE id = ?',
            [$id],
        );
    }

    public function insert(string $name, string $budget): int
    {
        return (int) $this->insertRowGetId(
            'INSERT INTO project (name, budget) VALUES (?, ?) RETURNING id',
            [$name, $budget],
        );
    }
}
```

An **entity** is a typed object hydrated from a row. Properties are public, named like the columns:

```php
namespace App\Models\Project\Entities;

use Zephyrus\Data\Entity;
use Zephyrus\Data\JsonIgnore;

enum Status: string
{
    case Active = 'active';
    case Archived = 'archived';
}

final class Project extends Entity
{
    public int $id;
    public string $name;
    public Status $status;
    public string $budget;
    /** @var list<string> */
    public array $tags;
    public ?\stdClass $meta = null;
    #[JsonIgnore]
    public string $internalNote = '';
}
```

A **service** is a plain class that calls the broker and hydrates entities. `Project::build($row)` returns `null` for a `null` row; `Project::buildArray($rows)` hydrates a list:

```php
final class ProjectService
{
    public function __construct(private readonly ProjectBroker $projects)
    {
    }

    public function find(int $id): ?Project
    {
        return Project::build($this->projects->findById($id));
    }
}
```

### Hydration rules

- Each column is cast to the declared type of the property with the same name. A column without a matching public property is ignored; `getRawData()` returns the whole original row.
- A column named in `snake_case` needs an alias (`created_at AS "createdAt"`) to reach a `camelCase` property.
- A backed enum property takes `Enum::from()`. A value outside the enum throws an `InvalidArgumentException` that names the property, not the value.
- A `stdClass` property keeps the decoded JSON object. A property typed as another `Entity` is built from a JSON object column.
- A `null` is assigned as is: declare every nullable column as `?type`, or hydration throws a `TypeError`. A union or intersection type that does not accept `null` throws it too (before 3.17 the column was skipped): use a simple type such as `?string`, not a nullable union, since a union never receives a non-null value (see the next point).
- A date property typed `DateTimeImmutable`, `DateTimeInterface` or `DateTime` takes an ISO string (`YYYY-MM-DD`, with optional time, fraction and UTC offset) and is hydrated as a `DateTimeImmutable` (a `DateTime` for a `DateTime` property). A string that does not fit throws `InvalidArgumentException` (`Invalid value for date DateTimeImmutable on property $createdAt`). Version 0.14.1 left the property uninitialized.
- A value that cannot be hydrated is refused, where 0.14.1 skipped it or failed with an error: a property typed with another class, a union or intersection type, or a pure enum throws `InvalidArgumentException` (`Cannot hydrate property $status of App\Models\Order: type string|int is not supported`), and so does a nested entity given something other than a JSON object (`Invalid value for entity App\Models\Customer on property $customer`). Give the property a supported type, or read the column as a string and convert it in the service.
- Private and static properties, and a column named `rawData`, are skipped.

A property the entity cannot write is refused with `InvalidArgumentException`, where PHP raised a bare `Error`. A readonly property left uninitialized and a `protected(set)` property are hydrated, and `json_encode()` leaves out a virtual property with no `get` hook.

| Property | Refusal |
|---|---|
| `public readonly int $id`, set by the constructor | `Cannot hydrate property $id of App\Models\Project: it is readonly and its constructor already set it. Leave it unset in the constructor, or drop readonly.` |
| `public private(set) string $name` | `Cannot hydrate property $name of App\Models\Project: its private(set) visibility keeps Entity from writing it. Use protected(set) instead.` |
| `public string $label { get => ... }`, virtual with no `set` hook | `Cannot hydrate property $label of App\Models\Project: it is virtual with no set hook. Alias the column in the query, or give the property a set hook.` |

### Serializing entities

`json_encode($entity)` emits the public, non-static properties that were assigned and skips those marked `#[JsonIgnore]` (password hashes, internal identifiers). Only entities honour the attribute: a `stdClass` row, or the items of a `PaginatedResult`, serialize every selected column. Select explicit columns, or hydrate before serializing.

## Errors

Every failure of the data layer is a `DatabaseException`. Its message carries the SQLSTATE and nothing else, so it is safe to log without leaking values:

```php
use Zephyrus\Data\DatabaseException;

try {
    $db->insert('INSERT INTO project (name) VALUES (?)', ['Gamma']);
} catch (DatabaseException $e) {
    $e->getMessage();   // "Query failed [SQLSTATE 23505]: statement and driver detail withheld, read sql() and driverMessage() to inspect them"
    $e->sqlState();     // "23505"
    $e->sql();          // "INSERT INTO project (name) VALUES (?)"
    $e->driverMessage(); // "SQLSTATE[23505]: Unique violation: 7 ERROR:  duplicate key value violates unique constraint ..."
}
```

Branch on `sqlState()` (for example `23505` for a unique violation, `23503` for a foreign key). Log `driverMessage()` and `sql()`, but never show them to a visitor: the driver text can contain column values.

## Listings from request input

Four small classes turn a query string into a safe listing. All of them take the array from `$request->query`.

```php
use Zephyrus\Data\FilterRequest;
use Zephyrus\Data\PaginationRequest;
use Zephyrus\Data\SortRequest;

// GET /projects?page=1&per_page=500&sort=-name&status=active
$page = PaginationRequest::fromQuery($request->query, defaultPerPage: 25, maxPerPage: 100);
$sort = SortRequest::fromQuery($request->query, ['name', 'created_at'], defaultColumn: 'name');
$filter = FilterRequest::fromQuery($request->query, ['status']);

$result = $db->paginateFilteredSortedResultWith(
    'SELECT id, name, status FROM project',   // no WHERE, no ORDER BY
    'SELECT count(*) FROM project',
    $filter,
    ['status' => 'status'],                   // query key => column
    $sort,
    $page,
);
```

- `PaginationRequest::fromQuery()` reads `page` (or `offset`) and `per_page` (also `perPage`, `page_size`, `pageSize`, `limit`). The page size is clamped between 1 and `maxPerPage`, so `per_page=500` cannot ask for 500 rows, and the page is clamped so the offset cannot overflow: a page beyond the last one returns an empty list, it does not fail. `fromArrayWithBounds()` is the same call. `fromArray()` applies no ceiling without its `maxPerPage` argument: use it for values you already validated, never for a raw request.
- `SortRequest::fromQuery()` requires an allowlist of columns. A column outside it, including any injection attempt, falls back to the default column. It reads `sort` (`name` ascending, `-name` descending), `sort_by` or `orderBy`, and `sort_dir` or `direction`. `fromArray()` is for validated input and accepts any identifier-shaped column unless you pass `allowedColumns`.
- `$sort->toSql()` already starts with ` ORDER BY` and quotes the identifier: never write `ORDER BY` before it.
- `FilterRequest::fromQuery()` keeps only the allowed keys and builds exact-match conditions: `status=active` becomes `"status" = :f_status`, a repeated key (`status[]=a&status[]=b`) becomes an `IN` list, and a third argument lists keys read as comma-separated values. The values are bound parameters. Keys missing from the column map you pass to the query method are ignored.

The result is a `PaginatedResult`:

```php
$result->items;        // list<stdClass>
$result->total;        // 20, rows matching the filter
$result->page;         // 1
$result->perPage;      // 100 (500 was clamped)
$result->totalPages;
$result->hasPrevious;
$result->hasNext;
```

It also offers `isEmpty()`, `itemCount()`, `firstItem()`, `lastItem()`, `isFirstPage()`, `isLastPage()`, `nextPageNumber()`, `previousPageNumber()`, `toPaginationRequest()`, and `mapItems($callable)` to turn each row into an entity or a view model. `toArray()` and `json_encode()` give `items`, `total`, `page`, `per_page`, `total_pages`, `has_previous` and `has_next`, ready for a JSON response:

```php
return $this->json($result->toArray());
```

The smaller pieces are on both `Database` and `Broker`: `selectPageWith()`, `selectSorted()`, `selectFiltered()`, `selectFilteredSorted()`, `selectPageSorted()`; `paginateWith()` and `paginateSortedWith()`, which return an array; `paginateResultWith()`, `paginateSortedResultWith()`, `paginateResultMappedWith()` and `paginateResultFromQuery($sql, $countSql, $request->query)`, which return a `PaginatedResult`. The variants without `With` take a page number and a size instead of a `PaginationRequest`.

## Good to know

- Always let the framework bind values. The SQL text itself must never hold request input: `SortRequest` and `FilterRequest` exist so identifiers come from your allowlist.
- The filter and sort requests append to your query, so the data and count queries must not already contain `WHERE` or `ORDER BY`. Add fixed conditions in a subquery or a view instead. Use named placeholders such as `:min` and bind them through the last `$params` argument. The filter itself binds named parameters, so a positional `?` would be refused as a mix:

  ```php
  $result = $db->paginateFilteredSortedResultWith(
      'SELECT id, name, status FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      'SELECT count(*) FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      $filter, ['status' => 'status'], $sort, $page, ['min' => '100'],
  );
  ```
- Pass a count query that matches the data query. They are separate statements, and the total comes from the count.
- Inserts return ids through `RETURNING` only (`insertGetId()` in `Database`, `insertRowGetId()` in a `Broker`).
- Keep a transaction short and let exceptions escape it.
- `Database::setSharedColumnMetadataEnabled()`, `flushSharedColumnMetadata()` and the `column_cache_version` key belong to the [column type cache](#column-type-cache), which APCu shares between requests when it is installed. Most applications never touch them.
