# kanjiStrokes

A quiet, responsive kanji stroke-order study space, with advanced examples for JLPT N1 preparation.

Enter a kanji or paste a Japanese word, then select each character to study it. Play, pause, replay, or advance one stroke at a time. Change the pace, toggle the practice grid, and reveal stroke numbers. Animations respect reduced-motion preferences.

The examples are study suggestions, not an official JLPT vocabulary or kanji list. Non-kanji text is ignored, repeated characters are combined, and each submission accepts up to 20 distinct characters. Readings and meanings are provided for the bundled examples; other characters show stroke order only.

## Run locally

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

No install or build step is needed. Serve the directory over HTTP rather than opening `index.html` directly, so the browser can fetch SVG data.

## Publish on GitHub Pages

The included `.github/workflows/pages.yml` publishes the static site on pushes to `main`, or manually through **Actions → Deploy to GitHub Pages → Run workflow**.

1. In the repository’s **Settings → Pages**, choose **GitHub Actions** as the build and deployment source (the workflow also requests Pages enablement).
2. Push these files to `main`.
3. Open the deployment URL shown by the workflow. For this repository, the expected address is `https://raux.github.io/kanjiStrokes/`.

All site assets use relative paths, including the bundled SVGs, so both project Pages and custom domains work. The workflow uploads only the public site files, not repository metadata.

## Stroke data and attribution

Stroke geometry and order come from [KanjiVG](https://kanjivg.tagaini.net/) by Ulrich Apel, licensed under [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The original licensed SVGs and license are retained in `data/`; the app changes their presentation to animate the paths. Rendered adaptations of this stroke data are also CC BY-SA 3.0.

The examples 木, 憂, 響, 曖, 昧, 繊, 細, and 鬱 are bundled and work without a stroke-data network request. Other kanji are fetched on demand from KanjiVG on `raw.githubusercontent.com`, pinned to revision `70a0b7ae0c18ceb5cb358274b029cce0234a43bc`, and cached in memory. An internet connection is required for those characters; unavailable data and connection errors are shown with a retry option. Google Fonts is optional; system fonts are used if it cannot load.
