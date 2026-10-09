<?php

declare(strict_types=1);

// Leaf indexes every rendered route, including the custom error page.
// Keep error pages renderable while removing them from the public sitemap.
$path = dirname(__DIR__) . '/dist/sitemap.xml';
$document = new DOMDocument();
if (!$document->load($path)) {
    throw new RuntimeException('Unable to load the Leaf sitemap.');
}
$removed = 0;
foreach (iterator_to_array($document->getElementsByTagName('url')) as $entry) {
    $location = $entry->getElementsByTagName('loc')->item(0)?->textContent ?? '';
    if (preg_match('~/404(?:/|\.html)?$~', parse_url($location, PHP_URL_PATH) ?? '')) {
        $entry->parentNode->removeChild($entry);
        $removed++;
    }
}
$document->save($path);
echo "SEO: {$removed} error routes excluded from sitemap.\n";
