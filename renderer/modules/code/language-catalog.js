// W59c 代码格式目录：新建文件、扩展名识别、语言菜单共用一张表，禁止三处手抄再漂移。
export const LANGUAGE_TIERS = [
  { id: 'run', code: 'A', label: '直跑', group: '01_run' },
  { id: 'compile', code: 'B', label: '编译', group: '02_compile' },
  { id: 'preview', code: 'C', label: '预览', group: '03_preview' },
  { id: 'none', code: 'D', label: '标记 / 数据', group: '04_none' },
];

const L = (id, label, ext, tier, template = '', aliases = []) => ({ id, label, ext, tier, template, aliases });

export const LANGUAGE_CATALOG = [
  // A：解释器/单文件直跑（29）
  L('javascript', 'JavaScript', 'js', 'run', `function main() {\n  console.log('Hello, Mazz!');\n}\n\nmain();\n`, ['mjs', 'cjs', 'jsx']),
  L('typescript', 'TypeScript', 'ts', 'run', `function main(): void {\n  console.log('Hello, Mazz!');\n}\n\nmain();\n`, ['mts', 'tsx']),
  L('python', 'Python', 'py', 'run', `#!/usr/bin/env python3\n\ndef main():\n    print("Hello, Mazz!")\n\n\nif __name__ == "__main__":\n    main()\n`),
  L('shell', 'Shell', 'sh', 'run', `#!/usr/bin/env sh\n\nmain() {\n  printf '%s\\n' 'Hello, Mazz!'\n}\n\nmain "$@"\n`),
  L('powershell', 'PowerShell', 'ps1', 'run', `function Main {\n  Write-Output 'Hello, Mazz!'\n}\n\nMain\n`),
  L('bat', 'Windows Batch', 'bat', 'run', `@echo off\necho Hello, Mazz!\n`, ['cmd']),
  L('ruby', 'Ruby', 'rb', 'run', `#!/usr/bin/env ruby\n\ndef main\n  puts 'Hello, Mazz!'\nend\n\nmain\n`),
  L('php', 'PHP', 'php', 'run', `<?php\nfunction main(): void {\n    echo "Hello, Mazz!\\n";\n}\n\nmain();\n`),
  L('perl', 'Perl', 'pl', 'run', `#!/usr/bin/env perl\nuse strict;\nuse warnings;\n\nsub main {\n    print "Hello, Mazz!\\n";\n}\n\nmain();\n`),
  L('lua', 'Lua', 'lua', 'run', `local function main()\n  print("Hello, Mazz!")\nend\n\nmain()\n`),
  L('r', 'R', 'r', 'run', `main <- function() {\n  print("Hello, Mazz!")\n}\n\nmain()\n`),
  L('julia', 'Julia', 'jl', 'run', `function main()\n    println("Hello, Mazz!")\nend\n\nmain()\n`),
  L('groovy', 'Groovy', 'groovy', 'run', `static void main(String[] args) {\n  println 'Hello, Mazz!'\n}\n`),
  L('dart', 'Dart', 'dart', 'run', `void main() {\n  print('Hello, Mazz!');\n}\n`),
  L('haskell', 'Haskell', 'hs', 'run', `main :: IO ()\nmain = putStrLn "Hello, Mazz!"\n`),
  L('scala', 'Scala', 'scala', 'run', `object Main {\n  def main(args: Array[String]): Unit = {\n    println("Hello, Mazz!")\n  }\n}\n`),
  L('clojure', 'Clojure', 'clj', 'run', `(ns main)\n\n(defn -main [& _]\n  (println "Hello, Mazz!"))\n\n(-main)\n`),
  L('elixir', 'Elixir', 'exs', 'run', `defmodule Main do\n  def main, do: IO.puts("Hello, Mazz!")\nend\n\nMain.main()\n`, ['ex']),
  L('erlang', 'Erlang', 'erl', 'run', `-module(main).\n-export([main/0]).\n\nmain() ->\n    io:format("Hello, Mazz!~n").\n`),
  L('ocaml', 'OCaml', 'ml', 'run', `let main () =\n  print_endline "Hello, Mazz!"\n\nlet () = main ()\n`),
  L('crystal', 'Crystal', 'cr', 'run', `def main\n  puts "Hello, Mazz!"\nend\n\nmain\n`),
  L('nim', 'Nim', 'nim', 'run', `proc main() =\n  echo "Hello, Mazz!"\n\nmain()\n`),
  L('d', 'D', 'd', 'run', `import std.stdio;\n\nvoid main() {\n    writeln("Hello, Mazz!");\n}\n`),
  L('go', 'Go', 'go', 'run', `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Mazz!")\n}\n`),
  L('java', 'Java', 'java', 'run', `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Mazz!");\n    }\n}\n`),
  L('zig', 'Zig', 'zig', 'run', `const std = @import("std");\n\npub fn main() !void {\n    try std.io.getStdOut().writer().print("Hello, Mazz!\\n", .{});\n}\n`),
  L('swift', 'Swift', 'swift', 'run', `@main\nstruct Main {\n    static func main() {\n        print("Hello, Mazz!")\n    }\n}\n`),
  L('fsharp', 'F#', 'fsx', 'run', `[<EntryPoint>]\nlet main _ =\n    printfn "Hello, Mazz!"\n    0\n`, ['fs']),
  L('sql', 'SQL（SQLite）', 'sql', 'run', `-- SQLite 单文件脚本\nSELECT 'Hello, Mazz!' AS message;\n`),

  // B：先编译后运行（8）
  L('rust', 'Rust', 'rs', 'compile', `fn main() {\n    println!("Hello, Mazz!");\n}\n`),
  L('c', 'C', 'c', 'compile', `#include <stdio.h>\n\nint main(void) {\n    puts("Hello, Mazz!");\n    return 0;\n}\n`, ['h']),
  L('cpp', 'C++', 'cpp', 'compile', `#include <iostream>\n\nint main() {\n    std::cout << "Hello, Mazz!\\n";\n    return 0;\n}\n`, ['cc', 'cxx', 'hpp']),
  L('csharp', 'C#', 'cs', 'compile', `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, Mazz!");\n    }\n}\n`),
  L('kotlin', 'Kotlin', 'kt', 'compile', `fun main() {\n    println("Hello, Mazz!")\n}\n`),
  L('fortran', 'Fortran', 'f90', 'compile', `program main\n  print *, "Hello, Mazz!"\nend program main\n`, ['f95', 'f03']),
  L('pascal', 'Pascal', 'pas', 'compile', `program Main;\nbegin\n  WriteLn('Hello, Mazz!');\nend.\n`),
  L('objective-c', 'Objective-C', 'm', 'compile', `#include <stdio.h>\n\nint main(void) {\n    puts("Hello, Mazz!");\n    return 0;\n}\n`),

  // C：浏览器预览（1）
  L('html', 'HTML', 'html', 'preview', `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>未命名</title>\n</head>\n<body>\n  <main>Hello, Mazz!</main>\n</body>\n</html>\n`, ['htm']),

  // D：明确不可运行（7）
  L('markdown', 'Markdown', 'md', 'none', `# 未命名\n\n`),
  L('svg', 'SVG', 'svg', 'none', `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">\n  <rect width="100%" height="100%" fill="#16181d"/>\n</svg>\n`),
  L('json', 'JSON', 'json', 'none', `{\n  "name": "untitled"\n}\n`),
  L('css', 'CSS', 'css', 'none', `:root {\n  color-scheme: light dark;\n}\n`),
  L('yaml', 'YAML', 'yml', 'none', `name: untitled\n`, ['yaml']),
  L('xml', 'XML', 'xml', 'none', `<?xml version="1.0" encoding="UTF-8"?>\n<root/>\n`),
  L('plaintext', '纯文本', 'txt', 'none', ''),
];

export const LANGUAGE_BY_ID = Object.fromEntries(LANGUAGE_CATALOG.map(x => [x.id, x]));
export const LANGUAGE_BY_EXT = Object.fromEntries(LANGUAGE_CATALOG.flatMap(x => [x.ext, ...x.aliases].map(ext => [ext, x.id])));
export const PRIMARY_EXT_BY_LANGUAGE = Object.fromEntries(LANGUAGE_CATALOG.map(x => [x.id, x.ext]));
export const ALL_CODE_EXTENSIONS = [...new Set(LANGUAGE_CATALOG.flatMap(x => [x.ext, ...x.aliases]))];
export const CODE_FILE_EXTENSIONS = LANGUAGE_CATALOG.map(x => x.ext);
export const CODE_FILE_DEFAULTS = Object.fromEntries(LANGUAGE_CATALOG.map(x => [x.ext, () => x.template]));
export const CODE_NEW_FILE_TYPES = LANGUAGE_CATALOG.map(x => {
  const tier = LANGUAGE_TIERS.find(t => t.id === x.tier);
  return { label: x.label, ext: x.ext, group: `代码 · ${tier.code} ${tier.label}（${LANGUAGE_CATALOG.filter(y => y.tier === x.tier).length}）`, language: x.id, tier: x.tier };
});

export const languageName = (id) => LANGUAGE_BY_ID[id]?.label || id;
export const languageTier = (id) => LANGUAGE_BY_ID[id]?.tier || 'none';
