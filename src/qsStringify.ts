import qs from "qs";

export function qsStringify(val: any) {
  return qs.stringify(val, {
    encodeValuesOnly: true,
    arrayFormat: "brackets",
  });
}
