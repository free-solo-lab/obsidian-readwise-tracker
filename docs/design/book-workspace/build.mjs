import { readFile, writeFile } from 'node:fs/promises';

const fragment = await readFile(new URL('./workspace.fragment.html', import.meta.url), 'utf8');
const document = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Пространство книги — интерактивные макеты</title>
<style>
:root { color-scheme: dark; background: #101315; }
body { margin: 0; padding: 28px; }
body > main { max-width: 1600px; margin: auto; }
@media (max-width: 580px) { body { padding: 12px; } }
@media (prefers-color-scheme: light) { :root { color-scheme: light; background: #f3f2ee; } }
</style>
<script src="./icons.js"></script>
<script>
(() => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('book-workspace-prototype-v1')); } catch {}
  window.openai = {
    widgetState: saved,
    setWidgetState: async value => {
      window.openai.widgetState = value;
      try { localStorage.setItem('book-workspace-prototype-v1', JSON.stringify(value)); } catch {}
    }
  };
})();
</script>
</head>
<body><main>${fragment}</main></body>
</html>`;
await writeFile(new URL('./index.html', import.meta.url), document);
console.log('Built docs/design/book-workspace/index.html');
