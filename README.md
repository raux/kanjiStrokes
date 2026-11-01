# kanjiStrokes

A quiet, responsive kanji stroke-order study space, with advanced examples for JLPT N1 preparation.

Enter a kanji or paste a Japanese word, then select each character to study it. Play, pause, replay, or advance one stroke at a time. Change the pace, toggle the practice grid, and reveal stroke numbers. Animations respect reduced-motion preferences.

Below the stroke-order study area, a handwriting practice panel lets you draw the selected kanji with a mouse, finger, or stylus; save an attempt; replay it at 0.5×, 1×, or 2×; and mark characters to “remember” for a quiet next-day review cue.

The kanji deck can draw from its built-in playful cards or any named saved list on this device. Cards drawn from saved lists display available meanings and readings; a missing meaning is marked unavailable. The reflections on built-in cards are playful, not predictions.

The examples are study suggestions, not an official JLPT vocabulary or kanji list. Non-kanji text is ignored, repeated characters are combined, and each submission accepts up to 20 distinct characters. Readings and meanings are provided for the bundled examples; other characters show stroke order only.

## Run locally

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

No install or build step is needed. Serve the directory over HTTP rather than opening `index.html` directly, so the browser can fetch SVG data.

## Text study

The Text tab ranks individual kanji by frequency and shows best-effort contextual word readings in hiragana. In the contextual reading, darker highlights indicate more frequent kanji; tap a kanji or select it in the ranking to add it to your existing study list (up to 20 characters) for Learn and Practice. Use Saved lists to keep the list. Unknown words are marked, and individual readings are possible readings rather than contextual pronunciations. Contextual word meanings are not yet provided.

Analysis runs in a browser worker: the pasted passage is not sent to the dictionary hosts or saved by the feature. On first use it downloads kuromoji.js 0.1.2 and its IPADIC dictionary from jsDelivr and kanji-data from a pinned GitHub revision via jsDelivr. This requires a network connection; substantial dictionary downloads can be slow on mobile. Studying selected characters may request their stroke data from GitHub and, when meanings are missing, individual characters from kanjiapi.dev, as in the existing study flow.

Tokenizer: [kuromoji.js](https://github.com/takuyaa/kuromoji.js), Apache-2.0, with IPADIC dictionary. Kanji data: [Kanji Data](https://github.com/davidluzgouveia/kanji-data), MIT, derived from KANJIDIC and other sources; see upstream attribution and [EDRDG licence](https://www.edrdg.org/edrdg/licence.html). Data is downloaded from its provider, not redistributed in this repository.

## Ink Dungeon with saved lists

On the Ink Dungeon start screen, choose **Default dungeon** or a named saved list as the kanji source. Saved-list runs use five single-kanji encounters per floor, repeating characters as needed; they have no word elites, boss or elite relics. The same seed and list produce the same initial layout. Kanji without an available meaning remain visible as a recall cue. Stroke data not bundled with the app requires a connection; if it cannot load, retry or retreat (retreat costs resolve). Saved lists are read from this browser and are not modified.

## Back up saved lists

Open **Saved lists** and choose **Export lists** to download a JSON backup. **Import lists** merges a backup into the current browser without overwriting existing lists. Duplicates (same kanji in the same order), invalid entries and entries beyond the 20-list limit are skipped and reported. Each list may contain up to 20 distinct kanji. Files are processed locally and limited to 1 MB. Handwriting attempts and review settings are not included.

## Practice data and privacy

- Handwriting capture happens only inside the practice panel’s writing area; the app does not record general keyboard input.
- Saved attempts contain stroke paths and timing only, stored in this browser with `localStorage` (`kanjiStrokes.practice.v1`). Nothing is uploaded or synced.
- At most 20 attempts per kanji are kept; the oldest is dropped when a newer one is saved.
- You can delete a single attempt or clear all local practice data from the practice panel. Clearing browser site data also removes it.
- Replays show your own recorded strokes; they are not graded or scored.

## Publish on GitHub Pages

The included `.github/workflows/pages.yml` publishes the static site on pushes to `main`, or manually through **Actions → Deploy to GitHub Pages → Run workflow**.

1. In the repository’s **Settings → Pages**, choose **GitHub Actions** as the build and deployment source (the workflow also requests Pages enablement).
2. Push these files to `main`.
3. Open the deployment URL shown by the workflow. For this repository, the expected address is `https://raux.github.io/kanjiStrokes/`.

All site assets use relative paths, including the bundled SVGs, so both project Pages and custom domains work. The workflow uploads only the public site files, not repository metadata.

## Stroke data and attribution

Stroke geometry and order come from [KanjiVG](https://kanjivg.tagaini.net/) by Ulrich Apel, licensed under [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The original licensed SVGs and license are retained in `data/`; the app changes their presentation to animate the paths. Rendered adaptations of this stroke data are also CC BY-SA 3.0.

The examples 木, 憂, 響, 曖, 昧, 繊, 細, and 鬱 are bundled and work without a stroke-data network request. Other kanji are fetched on demand from KanjiVG on `raw.githubusercontent.com`, pinned to revision `70a0b7ae0c18ceb5cb358274b029cce0234a43bc`, and cached in memory. An internet connection is required for those characters; unavailable data and connection errors are shown with a retry option. Google Fonts is optional; system fonts are used if it cannot load.
