import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSecMsGecV2, resetClockSkewForTests } from "./voiceReadEdgeTtsDrm.ts";

/** 与 edge-tts 7.3.1 generate_sec_ms_gec_v2 对齐的固定时间向量 */
const VECTORS: ReadonlyArray<readonly [number, string]> = [
  [
    1760540000.0,
    "58D142D398FCFFD5-57A627C93838DE6E9506F51952C84B8B6A9786B7AC833536587BE2C655EED5A4",
  ],
  [
    1760540300.0,
    "844B17D06C45CFA5-E42A6D0F15E90905F78E9DA379AC7339A57EA29A4FDE9780191035AC584CA8C0",
  ],
  [
    1760540600.0,
    "C4AFFDB41A2219ED-1AC32846FC7DDFACD3DA7642BC560F9629652C29485F18B54DA824F63FFB716E",
  ],
  [
    1700000000.0,
    "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
  ],
  [
    1735689600.0,
    "54404AFE67C9B44A-E72E51D8B4F5F75E9A96B7E20D7877227455BC310433BD30C817CD54A1D9313E",
  ],
];

describe("generateSecMsGecV2", () => {
  it("matches edge-tts vectors", () => {
    resetClockSkewForTests();
    for (const [ts, expected] of VECTORS) {
      assert.equal(generateSecMsGecV2(ts), expected, `ts=${ts}`);
    }
  });
});
