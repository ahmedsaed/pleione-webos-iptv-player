import qrcode from 'qrcode-generator';

/** Generate a PNG data URL containing a QR code for the given text. */
export function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}
