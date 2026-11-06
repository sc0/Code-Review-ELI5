const DEFAULTS = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  openrouterModel: 'anthropic/claude-opus-5.5',
  effort: 'low',
  mode: 'auto',
  skipOwn: true,
  skipBots: true,
};

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(text, kind) {
  status.textContent = text;
  status.className = kind || '';
}

async function send(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error || 'Unknown error');
  return res.result;
}

const selectedProvider = () => document.querySelector('input[name="provider"]:checked')?.value || 'anthropic';

function showProvider(provider) {
  for (const section of document.querySelectorAll('.provider-section')) {
    section.hidden = section.dataset.provider !== provider;
  }
  if (provider === 'openrouter') loadOpenRouterModels();
}

async function load() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ apiKey: '', openrouterApiKey: '' }),
  ]);
  $('apiKey').value = local.apiKey;
  $('openrouterApiKey').value = local.openrouterApiKey;
  $('model').value = sync.model;
  $('openrouterModel').value = sync.openrouterModel;
  $('effort').value = sync.effort;
  document.querySelector(`input[name="provider"][value="${sync.provider}"]`).checked = true;
  document.querySelector(`input[name="mode"][value="${sync.mode}"]`).checked = true;
  $('skipOwn').checked = sync.skipOwn;
  $('skipBots').checked = sync.skipBots;
  showProvider(sync.provider);
  refreshCacheInfo();
}

// Suggest OpenRouter models that support structured outputs. The list is public; no key needed.
let modelsLoaded = false;
async function loadOpenRouterModels() {
  if (modelsLoaded) return;
  modelsLoaded = true;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    const models = data
      .filter((m) => m.supported_parameters?.includes('structured_outputs') && !m.id.endsWith(':batch'))
      .sort((a, b) => a.id.localeCompare(b.id));
    const list = $('openrouterModels');
    list.replaceChildren(
      ...models.map((m) => {
        const option = document.createElement('option');
        option.value = m.id;
        option.label = m.name || m.id;
        return option;
      }),
    );
  } catch {
    modelsLoaded = false; // allow a retry next time the section is shown
    $('modelHint').textContent = "Couldn't load the model list. Enter a model ID from openrouter.ai/models.";
  }
}

async function refreshCacheInfo() {
  try {
    const count = await send({ type: 'eli5:cacheCount' });
    $('cacheInfo').textContent = `${count} cached`;
  } catch {
    $('cacheInfo').textContent = '';
  }
}

for (const radio of document.querySelectorAll('input[name="provider"]')) {
  radio.addEventListener('change', () => showProvider(selectedProvider()));
}

$('save').addEventListener('click', async () => {
  const provider = selectedProvider();
  const openrouterModel = $('openrouterModel').value.trim();
  if (provider === 'openrouter' && !openrouterModel) return say('Enter an OpenRouter model ID.', 'bad');

  await chrome.storage.sync.set({
    provider,
    model: $('model').value,
    openrouterModel: openrouterModel || DEFAULTS.openrouterModel,
    effort: $('effort').value,
    mode: document.querySelector('input[name="mode"]:checked').value,
    skipOwn: $('skipOwn').checked,
    skipBots: $('skipBots').checked,
  });
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    openrouterApiKey: $('openrouterApiKey').value.trim(),
  });
  say('Saved. Reload open PR tabs to apply mode and skip changes.', 'ok');
});

for (const button of document.querySelectorAll('button.test')) {
  button.addEventListener('click', async () => {
    const apiKey = $(button.dataset.key).value.trim();
    if (!apiKey) return say('Enter a key first.', 'bad');
    say('Testing…');
    try {
      await send({ type: 'eli5:testKey', provider: button.dataset.provider, apiKey });
      say('Key works.', 'ok');
    } catch (err) {
      say(err.message, 'bad');
    }
  });
}

$('clear').addEventListener('click', async () => {
  const removed = await send({ type: 'eli5:clearCache' });
  say(`Cleared ${removed} cached explanation${removed === 1 ? '' : 's'}.`, 'ok');
  refreshCacheInfo();
});

load();
