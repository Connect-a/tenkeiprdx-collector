import { noteFailure } from '../../../core/failures.js';

const VFX_SCOPES = { parse: 'VFX解析', build: 'VFX構築', play: 'VFX再生' };
export const noteParseFailure = (kind, err) => noteFailure(VFX_SCOPES.parse, kind, err);
export const noteBuildFailure = (kind, err) => noteFailure(VFX_SCOPES.build, kind, err);
export const notePlayFailure = (kind, err) => noteFailure(VFX_SCOPES.play, kind, err);
