---
title: HTTP
order: 2
description: A preview of requests and responses in the Zephyrus field guide.
---

# HTTP

Every response, explicit.

Request and response objects are central to Zephyrus. This chapter will explain their structure and how immutability shapes the flow through an application.

## Intentional changes

A response can be created with an explicit status. Updating a header returns a new response object.

```php
use Zephyrus\Http\Response;

$response = Response::json(['created' => true], 201);
$response = $response->withHeader('Cache-Control', 'no-store');

return $response;
```

## What this chapter will cover

- The request object and its typed parts
- JSON, HTML and redirect responses
- Headers, status codes and immutability
- The response lifecycle

> **Reference in preparation**
> This example is illustrative. The complete API will be documented against the updated core.
