const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { join: pathJoin } = require('node:path');

module.exports = async ({ pages, until, click, selectMedia, waitState, ended, control }) => {
  const [chrome, edge] = pages;
  const input = (page, id, value) => page.evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const select = (page, id, value) => page.evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const state = page => page.evaluate("({ ...document.querySelector('[data-testid=sfu-state]').dataset })");
  const stats = page => page.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  const snapshot = () => control('snapshot');
  const submit = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)}).form.requestSubmit()`);
  const selectChannel = (page, index) => page.evaluate(`document.querySelectorAll('.channel-tabs button')[${index}].click()`);
  async function join(page, id) {
    await until(() => page.evaluate(`!!document.querySelector('[data-room-id="${id}"] button')`), 'room visible');
    await page.evaluate(`document.querySelector('[data-room-id="${id}"] button').click()`);
    await until(() => page.evaluate(`!!document.querySelector('[data-joined-room-id="${id}"]')`), 'room joined');
  }
  async function start(page, id) {
    await select(page, 'sfu-room', id);
    await click(page, 'sfu-start');
    await until(async () => { const current = await state(page); return current.roomId === id && current.phase === 'sending'; }, 'SFU connected');
  }
  async function chat(page, message) {
    await input(page, 'chat-body', message);
    await submit(page, 'chat-body');
    await until(() => page.evaluate(`document.querySelector('[data-testid=chat-messages]').textContent.includes(${JSON.stringify(message)})`), 'chat received');
    await until(() => page.evaluate("document.getElementById('chat-body').value === ''"), 'successful chat clears draft');
  }
  async function checkLayout(page, browserName, width, height) {
    await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.evaluate('window.scrollTo(0, 0)');
    const layout = await page.evaluate(`(() => {
      const rect = selector => { const element = document.querySelector(selector); const r = element.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, rooms: rect('.rooms-panel'), media: rect('.conference-panel'), chat: rect('.chat-panel'), controls: rect('.call-controls'), chatInput: rect('#chat-body'), activeVideo: !!document.querySelector('.conference-panel video') };
    })()`);
    assert.equal(layout.width, width);
    assert.ok(layout.scrollWidth <= width + 1, `${browserName} ${width}px horizontal overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.media.width > 0 && layout.chat.width > 0 && layout.controls.width > 0 && layout.chatInput.width > 0 && layout.activeVideo);
    if (width >= 1200) assert.ok(layout.rooms.x < layout.media.x && layout.media.x < layout.chat.x, 'desktop columns');
    if (width < 768) {
      assert.ok(layout.media.y < layout.rooms.y && layout.media.y < layout.chat.y, 'mobile media first');
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.mobile-navigation')).display !== 'none' && Array.from(document.querySelectorAll('.mobile-navigation a')).every(link => document.querySelector(link.getAttribute('href')))"), true);
    }
    const folder = pathJoin(__dirname, '..', 'docs', 'assets', 'step18');
    await mkdir(folder, { recursive: true });
    const shot = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(pathJoin(folder, `${browserName.toLowerCase()}-${width}.png`), Buffer.from(shot.data, 'base64'));
    if (width === 390) for (const kind of ['devices', 'diagnostics']) {
      await page.evaluate(`document.getElementById(${JSON.stringify(kind + '-trigger')}).click()`);
      const modal = await page.evaluate(`(() => { const dialog = document.getElementById(${JSON.stringify(kind)}); const rect = dialog.getBoundingClientRect(); return { open: dialog.open, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, contentWidth: dialog.querySelector('.dialog-content').clientWidth, scrollWidth: dialog.querySelector('.dialog-content').scrollWidth }; })()`);
      assert.ok(modal.open && modal.left >= 0 && modal.right <= width && modal.top >= 0 && modal.bottom <= height && modal.contentWidth > 0, `${browserName} ${kind} modal: ${JSON.stringify(modal)}`);
      const modalShot = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(pathJoin(folder, `${browserName.toLowerCase()}-${width}-${kind}.png`), Buffer.from(modalShot.data, 'base64'));
      await page.evaluate(`document.querySelector(${JSON.stringify('#' + kind + ' .dialog-heading button')}).click()`);
    }
    console.log('DASHBOARD_LAYOUT ' + JSON.stringify({ browser: browserName, ...layout }));
  }

  for (const page of pages) await until(() => page.evaluate("!!document.getElementById('room-name') && !document.getElementById('room-name').disabled"), 'session ready');
  // A confirmed response closes the profile editor; an error preserves it.
  await chrome.evaluate("document.querySelector('.profile-menu').open = true");
  await input(chrome, 'nickname', 'dashboard-A'); await submit(chrome, 'nickname');
  await until(() => chrome.evaluate("!document.querySelector('.profile-menu').open && document.querySelector('.profile-menu summary').textContent.includes('dashboard-A')"), 'profile success closes editor');
  await chrome.evaluate("document.querySelector('.profile-menu').open = true");
  await input(chrome, 'nickname', 'x'.repeat(70)); await submit(chrome, 'nickname');
  await until(() => chrome.evaluate("!!document.querySelector('.header-message[role=alert]')"), 'profile rejection');
  assert.equal(await chrome.evaluate("document.querySelector('.profile-menu').open"), true);
  await chrome.evaluate("document.querySelector('.profile-menu button[type=button]').click(); document.querySelector('.profile-menu').open = true");
  await until(() => chrome.evaluate("document.getElementById('nickname').value === 'dashboard-A'"), 'profile reopens with applied values');
  await chrome.evaluate("document.querySelector('.profile-menu button[type=button]').click()");
  await chrome.evaluate("window.savedProfileSend = mediaProbe.socket.send; mediaProbe.socket.send = function(text) { const request = JSON.parse(text); if (request.type === 'profile.update' && !mediaProbe.heldProfile) { mediaProbe.heldProfile = text; return; } return savedProfileSend.call(this, text); }; void 0");
  await chrome.evaluate("document.querySelector('.profile-menu').open = true");
  await input(chrome, 'nickname', 'delayed-A'); await submit(chrome, 'nickname');
  await until(() => chrome.evaluate("!!mediaProbe.heldProfile"), 'held profile request');
  await chrome.evaluate("document.querySelector('.profile-menu button[type=button]').click(); document.querySelector('.profile-menu').open = true; mediaProbe.socket.send = window.savedProfileSend; mediaProbe.socket.send(mediaProbe.heldProfile)");
  await until(() => chrome.evaluate("document.querySelector('.profile-menu summary').textContent.includes('delayed-A')"), 'late profile response');
  assert.equal(await chrome.evaluate("document.querySelector('.profile-menu').open"), true);
  await chrome.evaluate("document.querySelector('.profile-menu button[type=button]').click()");
  await input(chrome, 'room-name', '1111'); await submit(chrome, 'room-name');
  await until(() => chrome.evaluate("document.querySelectorAll('[data-joined-room-id]').length === 1"), 'first room');
  await input(chrome, 'room-name', '2222'); await submit(chrome, 'room-name');
  await until(() => chrome.evaluate("document.querySelectorAll('[data-joined-room-id]').length === 2"), 'second room');
  const [roomA, roomB] = await chrome.evaluate("Array.from(document.querySelectorAll('[data-joined-room-id]')).map(element => element.dataset.joinedRoomId)");
  await join(edge, roomA); await join(edge, roomB);
  for (const page of pages) { await selectMedia(page, true, true); await click(page, 'media-start'); await waitState(page, 'ready'); await start(page, roomA); }
  await until(async () => (await stats(chrome)).received?.length === 2 && (await stats(edge)).received?.length === 2, 'two way consumers');
  const initial = await state(chrome);
  const before = await snapshot();
  assert.equal(before.media.slots.length, 2);
  const firstRtp = await stats(chrome);

  // A: chat changes while media and target remain on room A.
  await selectChannel(chrome, 2);
  assert.equal(await chrome.evaluate("document.getElementById('chat-channel').value"), roomB);
  await chrome.evaluate("document.querySelectorAll('.view-tabs button')[1].click()");
  assert.equal(await chrome.evaluate(`document.querySelector('[data-testid=chat-participants]').querySelectorAll('li').length`), 2);
  await chrome.evaluate("document.querySelectorAll('.view-tabs button')[0].click()");
  await chat(chrome, 'room-B-chat-while-A-media');
  await selectChannel(chrome, 1);
  await chrome.evaluate("window.savedChatSend = mediaProbe.socket.send; mediaProbe.socket.send = function(text) { const request = JSON.parse(text); if (request.type === 'chat.send' && !mediaProbe.heldChat) { mediaProbe.heldChat = text; return; } return savedChatSend.call(this, text); }; void 0");
  await input(chrome, 'chat-body', 'held-A-message'); await submit(chrome, 'chat-body');
  await until(() => chrome.evaluate("!!mediaProbe.heldChat"), 'held A room chat');
  await selectChannel(chrome, 2);
  await chrome.evaluate("mediaProbe.socket.send = window.savedChatSend; mediaProbe.socket.send(mediaProbe.heldChat)");
  await until(() => chrome.evaluate("!document.getElementById('chat-body').disabled"), 'held chat completed');
  assert.equal(await chrome.evaluate("document.getElementById('chat-channel').value"), roomB);
  assert.equal(await chrome.evaluate("document.getElementById('chat-body').value"), '');
  await selectChannel(chrome, 1);
  await until(() => chrome.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('held-A-message')"), 'held message delivered only to A');
  await selectChannel(chrome, 2);
  assert.equal(await chrome.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('held-A-message')"), false);
  await input(chrome, 'chat-body', 'new-B-draft-after-success');
  assert.equal(await chrome.evaluate("document.getElementById('chat-body').value"), 'new-B-draft-after-success');
  await input(chrome, 'chat-body', 'x'.repeat(501)); await submit(chrome, 'chat-body');
  await until(() => chrome.evaluate("!!document.querySelector('.header-message[role=alert]')"), 'chat rejection');
  assert.equal(await chrome.evaluate("document.getElementById('chat-body').value.length"), 501);
  await selectChannel(edge, 2);
  await until(() => edge.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('room-B-chat-while-A-media')"), 'B room message reaches member');
  assert.equal((await state(chrome)).mediaId, initial.mediaId);
  assert.equal(await chrome.evaluate("document.getElementById('sfu-room').value"), roomA);

  // B: target selection has no side effect on chat, SFU ownership, or media.
  await select(chrome, 'sfu-room', roomB);
  assert.equal(await chrome.evaluate("document.getElementById('chat-channel').value"), roomB);
  assert.equal((await state(chrome)).mediaId, initial.mediaId);
  const afterSelection = await snapshot();
  assert.deepEqual(afterSelection.media.slots.map(slot => ({ roomId: slot.roomId, mediaId: slot.mediaId, producers: slot.producers.map(producer => producer.id) })), before.media.slots.map(slot => ({ roomId: slot.roomId, mediaId: slot.mediaId, producers: slot.producers.map(producer => producer.id) })));
  await until(async () => (await stats(chrome)).received.some(track => track.bytesReceived > firstRtp.received.find(previous => previous.id === track.id)?.bytesReceived), 'RTP continues after target selection');

  // D: explicit switching keeps the right chat on A.
  await selectChannel(chrome, 1);
  await start(chrome, roomB);
  assert.equal(await chrome.evaluate("document.getElementById('chat-channel').value"), roomA);
  const afterSwitch = await snapshot();
  assert.equal(afterSwitch.media.slots.find(slot => slot.participantId === before.media.slots.find(slot => slot.roomId === roomA && slot.producers.length === 2)?.participantId)?.roomId, roomB);
  assert.equal(afterSwitch.media.slots.filter(slot => slot.roomId === roomA).length, 1);
  await chat(chrome, 'room-A-chat-after-switch');
  await selectChannel(edge, 1);
  await until(() => edge.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('room-A-chat-after-switch')"), 'A room message after switch');

  // E: global chat also leaves the target and active room untouched.
  await selectChannel(chrome, 0);
  await chat(chrome, 'global-while-B-media');
  await selectChannel(edge, 0);
  await until(() => edge.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('global-while-B-media')"), 'global message');
  assert.equal((await state(chrome)).roomId, roomB);
  assert.equal(await chrome.evaluate("document.getElementById('sfu-room').value"), roomB);

  // Dialogs and chat/people view only change presentation. Native dialogs trap
  // focus and make the dashboard background inert while they are open.
  await input(chrome, 'chat-body', 'unsent-draft');
  await chrome.evaluate("document.querySelectorAll('.view-tabs button')[1].click(); document.getElementById('devices-trigger').click()");
  assert.equal(await chrome.evaluate("(() => { document.getElementById('room-name').focus(); return document.getElementById('devices').open && document.activeElement.closest('#devices') !== null; })()"), true);
  await chrome.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await chrome.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => chrome.evaluate("!document.getElementById('devices').open && document.activeElement.id === 'devices-trigger'"), 'device Escape closes and restores focus');
  assert.equal(await chrome.evaluate("document.getElementById('chat-body').value"), 'unsent-draft');
  assert.equal((await state(chrome)).roomId, roomB);
  await chrome.evaluate("document.querySelectorAll('.view-tabs button')[0].click(); document.getElementById('diagnostics-trigger').click()");
  assert.equal(await chrome.evaluate("document.getElementById('diagnostics').open && !!document.querySelector('[data-testid=sfu-stats]').textContent"), true);
  await chrome.evaluate("document.querySelector('#diagnostics .dialog-heading button').click()");
  await until(() => chrome.evaluate("!document.getElementById('diagnostics').open && document.activeElement.id === 'diagnostics-trigger'"), 'diagnostics close restores focus');
  assert.equal(await chrome.evaluate("document.getElementById('chat-body').value"), 'unsent-draft');
  assert.equal(await chrome.evaluate("mediaProbe.streams.every(stream => stream.getTracks().every(track => track.readyState === 'live'))"), true);

  for (const [page, name] of [[chrome, 'Chrome'], [edge, 'Edge']]) {
    for (const width of [1280, 900, 600, 390]) await checkLayout(page, name, width, 840);
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 1, mobile: false });
    const keyboard = await page.evaluate("(() => { const button = document.querySelector('.channel-tabs button'); button.focus(); return { focus: document.activeElement === button, name: button.textContent.trim(), selected: button.getAttribute('aria-selected') }; })()");
    assert.equal(keyboard.focus, true); assert.ok(keyboard.name); assert.ok(keyboard.selected);
  }
  await click(chrome, 'sfu-stop'); await click(edge, 'sfu-stop');
  await until(async () => !(await state(chrome)).roomId && !(await state(edge)).roomId, 'SFU stopped');
  for (const page of pages) { await click(page, 'media-stop'); await waitState(page, 'idle'); assert.equal(await ended(page), true); }
  const final = await control('shutdown');
  assert.equal(final.sessions, 0); assert.equal(final.media.slots.length, 0); assert.equal(final.media.native, null);
  console.log('PASS dashboard A-E: channel/target/active media independent, room/global chat delivery, no automatic SFU request, explicit switch, draft/panel lifetime, Chrome+Edge responsive layouts and clean shutdown');
};
