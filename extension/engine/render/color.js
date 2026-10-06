export const gammaToLinear = (v) => {
  const x = Number(v) || 0;
  if (x <= 0.04045) return x / 12.92;
  if (x < 1) return Math.pow((x + 0.055) / 1.055, 2.4);
  return Math.pow(x, 2.2);
};

export const linearToGamma = (v) => {
  const x = Number(v) || 0;
  if (x <= 0.0031308) return x * 12.92;
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
