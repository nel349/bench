/**
 * The one function of `qrcode` the page uses, typed here rather than through `@types/qrcode`, which
 * would be a second dependency for a single call.
 */
declare module "qrcode" {
  interface ToStringOptions {
    readonly type: "svg";
    /** Quiet zone around the code, in modules. */
    readonly margin?: number;
    readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    readonly color?: { readonly dark?: string; readonly light?: string };
  }
  const QRCode: { toString(text: string, options: ToStringOptions): Promise<string> };
  export default QRCode;
}
