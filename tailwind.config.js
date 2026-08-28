/** Tailwind の設定。使うクラスだけを先に作るため、原本を content に並べる。
 *  cdn.tailwindcss.com（ブラウザ内で CSS を生成する版）は使わない。
 *  以前は index.html の中に tailwind.config = {…} として書いてあった。 */
module.exports = Object.assign({ content: ["./src/**/*.jsx", "./index.html"] }, { theme: { extend: { fontFamily: { sans: ['"Zen Maru Gothic"', 'sans-serif'], serif: ['"Shippori Mincho"', '"Zen Old Mincho"', 'serif'] } } } });
