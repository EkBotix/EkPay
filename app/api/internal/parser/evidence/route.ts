import { createParserHandler } from "@/lib/parser/handler";
import { parserStore } from "@/lib/parser/store";
export const runtime="nodejs";
export const POST=createParserHandler('evidence',parserStore);
