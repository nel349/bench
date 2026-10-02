/**
 * Put text on the clipboard, or say it could not be done.
 *
 * The Clipboard API exists only on a page served securely, and the testnet gym is served over plain
 * http on a private network, so there `navigator.clipboard` is missing and every Copy button did
 * nothing. Selecting the text in a field and asking the browser to copy the selection is the older
 * way, and works on any page, as long as it happens inside the click.
 */
export async function writeClipboard(text: string, doc: Document = document): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator.clipboard;
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused; the older way below may still work.
    }
  }
  const field = doc.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  // Off screen, so the page does not jump or flash while it is selected.
  Object.assign(field.style, { position: "fixed", top: "-1000px", opacity: "0" });
  doc.body.appendChild(field);
  field.focus();
  field.select();
  try {
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
