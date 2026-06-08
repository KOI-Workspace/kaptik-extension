/// <reference types="vite/client" />
/// <reference types="chrome" />

// CSS를 문자열로 가져오는 ?inline import 타입 선언
declare module "*.css?inline" {
  const css: string;
  export default css;
}
