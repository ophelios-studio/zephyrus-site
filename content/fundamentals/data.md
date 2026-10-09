---
title: Data access
order: 5
description: Explicit SQL, Brokers and Entity objects in Zephyrus.
---

# Data access

Your SQL. Your data model.

Brokers group SQL queries for a domain. Query helpers handle bound parameters and returned data while keeping the query visible.

## An explicit query

```php
use stdClass;
use Zephyrus\Data\Broker;

final class ProductBroker extends Broker
{
    public function find(int $id): ?stdClass
    {
        return $this->selectOne(
            'SELECT id, name FROM product WHERE id = ?',
            [$id]
        );
    }
}
```

## Each responsibility has a home

The Broker holds SQL access. Services carry application logic. `Entity` objects can hydrate returned rows into typed objects.

## What comes next

> **Reference in preparation**
> Connection injection, transactions and complete examples will be checked against the updated core.
