<?php

declare(strict_types=1);

// Leaf indexes titles, headings and an excerpt that starts with the title:
// add each page's body text, and use the page's tagline as the excerpt.
const INLINE_TAGS = ['a', 'abbr', 'b', 'code', 'del', 'em', 'i', 'img', 'kbd', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup'];

function readableText(Dom\Node $node): string
{
    if ($node instanceof Dom\Text) {
        return $node->data;
    }
    $text = '';
    foreach ($node->childNodes as $child) {
        $text .= readableText($child);
    }
    $isBlock = $node instanceof Dom\Element && !in_array($node->localName, INLINE_TAGS, true);
    return $isBlock ? ' ' . $text . ' ' : $text;
}

function collapse(string $text): string
{
    return trim(preg_replace('/[ \t\r\n\f]+/u', ' ', $text));
}

$dist = dirname(__DIR__) . '/dist';
$indexes = [$dist . '/search.json', ...glob($dist . '/*/search.json')];
foreach ($indexes as $indexPath) {
    $entries = json_decode(file_get_contents($indexPath), true, flags: JSON_THROW_ON_ERROR);
    foreach ($entries as &$entry) {
        $pagePath = $dist . $entry['url'] . '/index.html';
        $prose = is_file($pagePath)
            ? Dom\HTMLDocument::createFromFile($pagePath, LIBXML_NOERROR)->querySelector('main .prose')
            : null;
        if ($prose === null) {
            throw new RuntimeException("No page content to index at {$pagePath}.");
        }
        foreach ($prose->querySelectorAll('h1, .heading-permalink') as $redundant) {
            $redundant->remove();
        }
        $tagline = $prose->querySelector('p');
        $text = collapse(readableText($prose));
        $entry['excerpt'] = $tagline === null ? mb_substr($text, 0, 160) : collapse($tagline->textContent);
        $entry['text'] = $text;
    }
    unset($entry);
    file_put_contents($indexPath, json_encode($entries, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    printf("Search: %d pages indexed in %s.\n", count($entries), substr($indexPath, strlen($dist)));
}
