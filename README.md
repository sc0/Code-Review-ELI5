Disclaimer: This is obviously AI slopped, but it works surprisingly well for me
so who cares 🤷

# PR Comment ELI5

**Code review comments, explained in plain language.**

Ever read a review comment like *"this could cause an N+1, consider eager loading"* and thought "...what?" This Chrome extension adds a small panel under each comment on a GitHub pull request that tells you:

- **What it means**: the comment in plain words, with the jargon spelled out
- **Like I'm five**: a one-line analogy anyone can follow
- **What to do**: the next step for you, the PR author

Each panel also gets a label, such as *change request*, *suggestion*, *question*, *nitpick* or *praise*, so you can see at a glance what needs fixing and what's just a friendly note.

Here's roughly what it looks like:

```
┌──────────────────────────────────────────────────────────────┐
│ ELI5  Change request                              ↻   Hide   │
│                                                              │
│ WHAT IT MEANS                                                │
│ The reviewer thinks this loop runs a separate database query │
│ for every user (an "N+1" problem), which gets slow as the    │
│ list grows.                                                  │
│                                                              │
│ LIKE I'M FIVE                                                │
│ It's like walking to the shop once for each egg instead of   │
│ buying the whole carton in one trip.                         │
│                                                              │
│ WHAT TO DO                                                   │
│ Load all the users' orders in a single query before the loop.│
└──────────────────────────────────────────────────────────────┘
```

---

## Get started in 2 minutes

1. **Get an API key** from one of these:
   - **Anthropic**: [platform.claude.com](https://platform.claude.com/settings/keys) (uses Claude directly)
   - **OpenRouter**: [openrouter.ai](https://openrouter.ai/settings/keys) (Claude or hundreds of other models, one account)
2. **Load the extension:**
   - Open `chrome://extensions`
   - Turn on **Developer mode** (top-right toggle)
   - Click **Load unpacked** and pick this folder
3. **Set it up:** the settings page opens on its own. Pick your provider, paste your key, click **Test**, then **Save**.
4. **Open any pull request on GitHub.** Panels appear under the comments as you scroll.

To get back to the settings, click the extension's icon in the Chrome toolbar.

> **Updating after changing the code?** Click the reload ↻ button on the extension's card in `chrome://extensions`, then refresh your GitHub tabs.

---

## Which provider should I pick?

| | **Anthropic** | **OpenRouter** |
|---|---|---|
| **Best for** | Simplest setup with Claude | Trying different models, or one bill for many |
| **Models** | Claude Opus 5.5, Sonnet 5.5, Haiku 5.5 | Any model ID, e.g. `anthropic/claude-opus-5.5` |
| **Extras** | If Claude wrongly declines a comment, another model answers automatically | Model picker suggests models that return clean JSON |

Not sure? Start with **Anthropic** and the default model. You can switch at any time.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| **Provider** | Anthropic | Where the explanations come from |
| **Model** | Claude Opus 5.5 | Opus gives the best explanations. Sonnet and Haiku are faster and cheaper |
| **Model ID** *(OpenRouter)* | `anthropic/claude-opus-5.5` | Type to search. Suggestions are models that work well with this extension |
| **Effort** | Low | How hard the model thinks. Low is fine for most comments. Try High for dense, technical reviews |
| **When to explain** | Automatically | *Automatically* explains each comment when it scrolls into view. *On click* adds an "Explain this comment" button instead |
| **Skip my own comments** | On | You already know what you meant 🙂 |
| **Skip bot comments** | On | CI, coverage and Dependabot comments are long and rarely need explaining |

---

## Good to know

**It only runs on pull requests.** Specifically `github.com/<owner>/<repo>/pull/<number>`, on both the Conversation and Files changed tabs.

**It won't explain the same comment twice.** Explanations are saved in your browser, so reopening a PR is instant and free. If someone edits a comment, it gets a fresh explanation. To regenerate one yourself, click **↻** on its panel. To start over completely, use **Clear cached explanations** in settings.

**It's light on your API bill.** Comments are only explained when you actually scroll to them, and at most three at a time.

**What gets sent, and where:** to explain a comment, the extension sends the comment, the PR title, the file name, a few lines of nearby code and up to three earlier replies in the thread to your chosen provider. With OpenRouter, that also goes to whichever company runs the model you picked.

> ⚠️ On **private repositories**, that includes private code. Check that this is OK with your team before using it on work repos.

**Your API keys stay in this browser.** They aren't synced to other devices, the GitHub page itself never sees them, and they're only sent to the provider you chose.

---

## Troubleshooting

| What you see | What to try |
|---|---|
| **No panels at all** | Make sure you're on a pull request page and refresh it. If you just reloaded the extension, refresh your GitHub tabs too |
| **"Add your … API key"** | Open settings, paste a key for the selected provider and click **Save**. Open panels retry on their own |
| **"API key was rejected"** | Click **Test** in settings. The key may be mistyped, revoked, or meant for the other provider |
| **"Out of credits"** | Top up your account with the provider |
| **"Couldn't serve this model"** *(OpenRouter)* | Check the Model ID for typos, or pick one from the suggestions |
| **"Unexpected response"** | Click **Retry**. If it keeps happening on OpenRouter, pick a model from the suggestion list |
| **"The extension was reloaded"** | Refresh the GitHub tab |
| **Panels on some comments but not others** | GitHub occasionally changes its page layout. See below |

### If GitHub changes its layout

The extension finds comments using CSS selectors listed at the top of `content.js` (`BODY_SELECTOR`, `EXCLUDE_SELECTOR`, `AUTHOR_SELECTOR`, `THREAD_SELECTOR`). If GitHub redesigns its pages and panels go missing, right-click a comment, choose **Inspect**, and update those selectors to match.

---

## How it's built

No build step and no dependencies. It's plain JavaScript you can read and edit directly.

| File | What it does |
|---|---|
| `manifest.json` | Tells Chrome what the extension is and which sites it can talk to |
| `content.js` | Runs on GitHub. Finds comments, collects context, and draws the panels |
| `content.css` | Panel styles. Uses GitHub's own colours, so it matches light and dark mode |
| `background.js` | Holds your API keys and talks to Anthropic or OpenRouter. Also handles retries, errors and the saved explanations |
| `options.html`, `options.js` | The settings page |
