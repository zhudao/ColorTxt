declare module "font-list" {
  export type GetFontsOptions = {
    disableQuoting?: boolean;
  };

  export function getFonts(options?: GetFontsOptions): Promise<string[]>;
  export function getFonts2(options?: GetFontsOptions): Promise<string[]>;

  const fontList: {
    getFonts: typeof getFonts;
    getFonts2: typeof getFonts2;
  };

  export default fontList;
}
