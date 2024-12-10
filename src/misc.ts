export function getFirstKeyOfType(obj: any, type: string) {
  for (let key in obj) {
    if (typeof obj[key] === type) {
      return key;
    }
  }
  return null;
}
export const toDataUrl = (js: string) =>
  new URL(`data:text/javascript,${encodeURIComponent(js)}`);
export class IdGen {
  private id = 0;

  next() {
    return this.id++;
  }
}
