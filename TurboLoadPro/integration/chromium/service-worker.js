const MENU_ID = "turboload-download-direct-link";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Download direct link with TurboLoad Pro",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || typeof info.linkUrl !== "string") return;
  let link;
  try {
    link = new URL(info.linkUrl);
  } catch {
    return;
  }
  if (link.protocol !== "http:" && link.protocol !== "https:") return;

  // No browsing data is stored. Handoff happens only after the user chooses this menu item.
  const handoff = `turbload://add?url=${encodeURIComponent(link.href)}`;
  chrome.tabs.create({ url: handoff }).catch(() => {
    // A browser may block an unregistered external protocol. The app also supports --url.
  });
});
