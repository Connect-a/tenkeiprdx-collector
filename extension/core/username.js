export const DEFAULT_PLAYER_NAME = 'おーじ';

export const applyUserName = (text, name) => (text == null ? text : String(text).replace(/%username%/gi, name || DEFAULT_PLAYER_NAME));
