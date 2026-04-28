# Editor Component Architecture

This architecture is designed to solve the "two-way binding problem" common in rich text editors.

Rich text editors maintain their own complex internal state (the DOM/Virtual DOM). When you try to sync this with React state (props), you often get **infinite loops** (Editor changes $\rightarrow$ React updates $\rightarrow$ Prop changes $\rightarrow$ Editor updates $\rightarrow$ Editor changes...) or **cursor jumping** (re-rendering the editor while typing).

```
+-----------------------------------------------------------------------+
|  EditorField (src/field/editor-field.tsx)                             |
|  - Handles Lazy Loading & Suspense                                    |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------+-----------------------------------+
|  EditorComponent (src/field/editor-component.tsx)                     |
|  - Manages Hash Refs (lastEmitted, normalizedIncoming)                |
|  - Handles onChange (Debouncing & Hash Checks)                        |
+-----------------------------------+-----------------------------------+
                                    |
                                    | (renders)
                                    v
+-----------------------------------+----------------------------------+
|  EditorContext (src/field/editor-context.tsx)                         |
|  - Wraps everything in <LexicalComposer>                              |
|  - Provides SharedHistory & SharedOnChange Contexts                   |
+------------------+---------------------------------+-----------------+
                   |                                 |
                   | (passed as children)            | (renders)
                   v                                 v
+------------------+------------------+  +-----------+------------------+
| ApplyValuePlugin                    |  | Editor (src/field/editor.tsx)|
| (src/field/apply-value-plugin.tsx)  |  | - ToolbarPlugin              |
|                                     |  | - ContentEditable            |
| - Watches: incoming value & hash    |  | - Floating Toolbars          |
| - Action: editor.update()           |  | - Auto-resize logic          |
|   (Syncs external props -> Editor)  |  +------------------------------+
+-------------------------------------+
```

### Key Relationships
1. `EditorComponent` is the "Brain". It holds the connection to the Payload form state (`useField`) and decides when to update the form value based on hashes.
2. `EditorContext` is the "Bridge". It initializes the Lexical instance (`LexicalComposer`) but doesn't contain the specific logic for syncing values or rendering the UI itself.
3. `ApplyValuePlugin` is the "Synchronizer". It sits inside the Lexical context. When `EditorComponent` receives a new value from the database (or parent), it passes it down here. This plugin forces the Lexical instance to update its state to match.
4. `Editor` is the "View". It handles the visual presentation, toolbars, and the actual `contentEditable` DOM element.


## EditorComponent

Here's how the `useRef` hooks inside editor-component.tsx solve editor-specific problems:

### 1. The "Debounce" Ref
**`dispatchFieldUpdateTask`**
*   **Purpose:** Performance.
*   **How it works:** When a user types, Lexical fires `onChange` on every keystroke. We don't want to update the main React state (and trigger re-renders up the tree) 60 times a second.
*   **Mechanism:** This ref stores the ID of the current `requestIdleCallback`. If a user types again before the callback runs, we cancel the old one and start a new one. It ensures we only process the *latest* state when the browser is idle.

### 2. The "Fresh Props" Refs
**`valueRef`** and **`initialValueRef`**
*   **Purpose:** Accessing state inside `useCallback` without dependencies.
*   **How it works:** The `handleChange` function is memoized via `useCallback`. If we added `value` to its dependency array, `handleChange` would be re-created every time the user typed, breaking our debounce logic.
*   **Mechanism:** We copy the props into these refs on every render. Inside `handleChange`, we read `valueRef.current`. This lets the function stay stable (same memory address) while still seeing the latest data.

### 3. The "Outbound Loop Breaker"
**`lastEmittedHashRef`**
*   **Purpose:** Preventing the "Echo" loop.
*   **The Problem:** You type "A". The editor emits "A". The parent saves "A" and passes "A" back down as a prop. The editor sees "A" and thinks, "Oh, a new value! I should process this."
*   **The Fix:** Before calling `onChange`, we calculate a hash of the content and store it here.
*   **Logic:** "If the hash I'm about to send is the same as the last one I sent, do nothing."

### 4. The "Inbound Normalization" Refs
**`normalizedIncomingHashRef`** and **`hasNormalizedBaselineRef`**
*   **Purpose:** Handling Lexical's strictness.
*   **The Problem:** Lexical is opinionated. If you load a value like `{"text": "hello"}`, Lexical might instantly transform it into a more complex structure (adding IDs, versions, etc.). This immediate transformation looks like a "change" event, which might trigger a save before the user has even touched the keyboard.
*   **`normalizedIncomingHashRef`:**
    *   The `ApplyValuePlugin` loads data, waits for Lexical to "settle" (normalize it), and then saves the hash of that *settled* state here.
    *   The `handleChange` function checks this: "Is this 'new' change just the result of the data I just loaded?" If yes, it ignores it.
*   **`hasNormalizedBaselineRef`:**
    *   This acts as a gatekeeper. It starts as `false`.
    *   It prevents the editor from emitting *any* changes until the initial value has been fully loaded and normalized. This stops the editor from accidentally overwriting the database with an empty state during the split-second it takes to mount.

### Summary Flow
1.  **User types:** `handleChange` triggers.
2.  **Debounce:** `dispatchFieldUpdateTask` ensures we wait for a pause.
3.  **Check Baseline:** `hasNormalizedBaselineRef` ensures we aren't just booting up.
4.  **Check Inbound:** `normalizedIncomingHashRef` ensures we aren't just reporting Lexical's own auto-formatting of the data we just gave it.
5.  **Check Outbound:** `lastEmittedHashRef` ensures we aren't reporting the same thing twice.
6.  **Success:** Only then do we call `onChange`.