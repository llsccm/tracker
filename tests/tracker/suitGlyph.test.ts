import { describe, expect, it } from 'vitest'

import { toSuitGlyphHtml } from '../../src/utils/index.js'

describe('花色字形', () => {
  it('不附加会强制文本字体回退的 U+FE0E', () => {
    const html = toSuitGlyphHtml('♥♦♠♣')

    expect(html).not.toContain('\uFE0E')
    expect(html).toContain('<span class="suit-glyph suit-heart">♥</span>')
    expect(html).toContain('<span class="suit-glyph suit-diamond">♦</span>')
    expect(html).toContain('<span class="suit-glyph suit-spade">♠</span>')
    expect(html).toContain('<span class="suit-glyph suit-club">♣</span>')
  })
})
