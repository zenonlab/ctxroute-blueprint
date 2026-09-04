---
match: [".php", "composer.json"]
mode: once
---

# PHP Sensor adapter

PHP and Laravel files remain explicitly lexical and must never be described as
AST. Do not add or claim a PHP grammar merely because a filename is recognized.
