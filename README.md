# Mind Board

An offline board-game app for the browser with three games:

| Game | Board | Pieces | Character |
|---|---|---|---|
| **Chess** | 8×8 | 16 each | Full standard rules |
| **Classic Checkers** | 8×8 | 12 each | Quick and familiar: men go forward, kings step one square |
| **International Dama** | 10×10 | 20 each | International draughts: flying kings, maximum capture |

Each game can be played two ways: **with a friend** on the same device (pass-and-play) or **versus AI**, with five levels that unlock one at a time. Each game has its own unlocks and its own saves.

- No accounts, no database, no online play, no external APIs or fonts. The app makes no network requests.
- Three files make up the whole app: `index.html`, `style.css` and `game.js`. Together they are about 134 KB, or about 37 KB gzipped.
- Every piece, icon and sound is original. Pieces are drawn as inline SVG and sounds are made with the Web Audio API.

## Running it

Double-click `index.html`, or open it in any modern browser. No build step, server or internet connection is needed.

You can also serve the folder with any static server (`npx serve .`, `python -m http.server`) to open it on a phone over your local network.

## Modes

| Mode | How it works |
|---|---|
| **With a friend** | Pass-and-play on one device with alternating turns. Undo works at any time. *Rotate for pass & play* in Settings turns the board toward whoever is to move. |
| **Versus AI** | Pick a level and a side (or Random). You can take back a move **only until the AI replies**. |

### AI levels (per game)

| Level | Name | Chess | Classic Checkers | International Dama |
|---|---|---|---|---|
| 1 | Novice | Random legal move, slight preference for captures | Random legal move | Random legal move |
| 2 | Casual | 1-ply search + heavy randomness | 2-ply + heavy randomness | 2-ply + heavy randomness |
| 3 | Club | 2-ply alpha-beta + capture search | 4-ply, light randomness | 3-ply, light randomness |
| 4 | Expert | 4-ply, capture search, killer moves | 7-ply with capture extensions | 5-ply with capture extensions |
| 5 | Master | Iterative deepening to 7 ply (~2.8 s) | Iterative deepening to 16 ply (~2.8 s) | Iterative deepening to 14 ply (~3 s) |

The AI never cheats. It only sees the current position and the move history, and it picks from the same legal-move generator you play against. It runs in a background Web Worker. If the browser blocks workers, it falls back to the main thread.

In self-play testing, every level beat the level below it in all three games.

## Rules

### Chess

Unchanged from v1.0: all legal moves, check, checkmate, stalemate, castling, promotion (choose Q/R/B/N), en passant, the 50-move rule, threefold repetition and insufficient material.

### Classic Checkers (8×8): English / American rules

- 12 pieces each on the dark squares. **Dark moves first.**
- Men move one square diagonally **forward**, and **capture forward only**.
- **Capturing is mandatory**, but you may choose **any** available capture. There is no maximum-capture rule.
- A capture sequence (**multi-jump**) must be completed with the same piece.
- Kings move and capture **one square** in any diagonal direction.
- A man that reaches the far row **during** a capture is crowned and **the move ends**.
- **Win:** the opponent has no pieces or no legal move.
- **Draw:** 40 moves each without a capture or a man move, threefold repetition, or one king each.

### International Dama (10×10): FMJD international draughts rules

- 20 pieces each on the dark squares. **Light moves first.**
- Men move one square diagonally forward but **capture forward and backward**.
- **Capturing is mandatory**, and you must play the sequence that captures the **most pieces** (maximum-capture rule). Captured pieces are removed after the move, and a piece cannot be jumped twice.
- **Flying kings** move any distance diagonally. They capture from a distance and may land on any empty square beyond the captured piece.
- A man is promoted only if it **ends** its move on the far row. Passing through it mid-capture does not promote.
- **Win:** the opponent has no pieces or no legal move.
- **Draws:**
  - threefold repetition
  - 25 moves each with only kings moving and no capture
  - lone-king endgames: **16 moves each** when three pieces (at least one a king) face a lone king, and **5 moves each** when two pieces or fewer (at least one a king) face a lone king

Both draughts games use official square numbering (1–32 and 1–50) for move notation and the on-board numbers.

## Rules screens & tutorials

- **App tutorial:** a 4-step introduction shown on first launch, and available again from *How to play*.
- **Game tutorials:** Classic Checkers and International Dama each have their own illustrated, paged tutorial, shown the first time you start that game. Each one is clearly labelled with the game name and board size.
- **Rules screens:** a full illustrated rules page for each draughts game, reachable from the game card (**Rules**), the new-game setup (**Full rules**) and the in-game pause menu.

## Controls

- **Touch / mouse:** tap a piece, then a highlighted square, or drag. For multi-jumps, tap each landing square in turn, or tap the final square when only one route leads there.
- **Keyboard:** the arrow keys move the cursor and **Enter/Space** selects or moves. **Esc** deselects or pauses, **U** or **Ctrl+Z** undoes, and **P** pauses.
- **Highlights:**
  - dots mark legal moves and rings mark captures
  - the last move is highlighted
  - a king in check glows red
  - pieces that are forced to capture pulse gold
  - pieces already jumped in a capture are dimmed

## Saving

Everything is stored in `localStorage` under the key `mindboard:v1` (data format version 2):

- settings
- unlocked AI levels **for each game**
- saved unfinished games **for each game and each mode**: Chess, Classic Checkers and International Dama each keep a separate *vs AI* save and *pass & play* save, so up to six saved games at once

Saves are stored as move lists and **replayed through the rules engine when loaded**. Anything corrupted or invalid is discarded instead of loading a broken position.

**Upgrading from v1.0** happens automatically:

- Settings, the tutorial flag and all unlocked levels are kept. The old checkers unlocks carry over to Classic Checkers.
- An unfinished chess game is kept as the chess save for its mode.
- An unfinished v1.0 checkers game is cleared. It used different rules, so it can't be replayed under either new game.

## Files

```
index.html   page structure and shared SVG gradients
style.css    dark game-room theme, responsive layout (phone-first, desktop two-column)
game.js      rules engines + AI (MindBoardEngines) and the interface
README.md    this file
```

`game.js` can also be loaded in Node (`require('./game.js')`) to get the engines (`Chess`, `Classic`, `Dama`, `AI`) for testing. `window.MindBoard` exposes a small debug and test hook in the browser.

## Testing performed (v1.1)

- **Chess regression:**
  - perft on the standard positions still matches exactly (start position to depth 4, Kiwipete to depth 3)
  - browser checks of promotion, checkmate and level unlocking
- **Classic Checkers rule tests:**
  - 12 pieces each, dark moves first
  - men cannot move or capture backwards
  - mandatory capture with a free choice between captures
  - sequences must be completed
  - one-square kings
  - crowning ends the move
  - the wipe-out, blocked, one-king-each and 40-move outcomes
  - 1–32 numbering
- **International Dama rule tests:**
  - 20 pieces each, light moves first
  - backward captures by men
  - the maximum-capture rule
  - flying-king slides and long-range captures
  - no double jumps
  - no promotion when passing the far row mid-capture
  - promotion
  - the 25-move, 5-move (played out) and 16-move draws
  - 1–50 numbering
- **AI self-play** at every level pair in both draughts games: no illegal moves, every game finished, and the slowest move took ~3 s.
- **Browser tests at 390×844 (touch) and 1440×900 (mouse and keyboard) for all three games:**
  - home cards
  - rules screens and tutorials
  - AI turns, including the AI moving first
  - the undo window
  - mandatory-capture highlights
  - multi-jumps tapped square by square
  - flying-king captures and promotion
  - win results
  - separate AI and friend saves restored after a reload
  - v1 → v2 migration
  - pause
  - drag and keyboard play on the 10×10 board

  The 10×10 board's squares are 36 px on a 390 px phone. There were no console errors, no horizontal scrolling and no network requests.
