// @yugnex/nexui — Native Layout Compiler (Rust/WASM)
// Compiles LayoutMatrix bitmasks to CSS rule strings.
// This module is optional — the TypeScript compiler in src/core/compiler.ts
// provides identical output. The Rust path exists for environments that
// pre-compile CSS at build time rather than at runtime in the browser.

use wasm_bindgen::prelude::*;
use std::collections::HashMap;

#[wasm_bindgen]
pub struct NexuiLayoutCompiler {
    cache: HashMap<u32, String>,
}

#[wasm_bindgen]
impl NexuiLayoutCompiler {
    #[wasm_bindgen(constructor)]
    pub fn new() -> NexuiLayoutCompiler {
        NexuiLayoutCompiler {
            cache: HashMap::new(),
        }
    }

    /// Compiles a 32-bit LayoutMatrix bitmask to a complete CSS rule string.
    /// The selector follows the pattern `.nx-m-{HEX}`.
    /// Returns an empty string if the bitmask encodes no layout properties.
    #[wasm_bindgen]
    pub fn compile(&mut self, bitmask: u32) -> String {
        if let Some(cached) = self.cache.get(&bitmask) {
            return cached.clone();
        }

        let mut css = String::new();

        // Padding (bits 0-3)
        match bitmask & 0x0F {
            0x1 => css.push_str("padding:0.25rem;"),
            0x2 => css.push_str("padding:0.5rem;"),
            0x3 => css.push_str("padding:0.75rem;"),
            0x4 => css.push_str("padding:1rem;"),
            0x5 => css.push_str("padding:1.5rem;"),
            0x6 => css.push_str("padding:2rem;"),
            _   => {}
        }

        // Display / Flex / Grid (bits 4-7)
        match bitmask & 0xF0 {
            0x10 => css.push_str("display:flex;flex-direction:row;"),
            0x20 => css.push_str("display:flex;flex-direction:column;"),
            0x30 => css.push_str("display:grid;grid-template-columns:repeat(2,1fr);"),
            0x40 => css.push_str("display:grid;grid-template-columns:repeat(3,1fr);"),
            0x50 => css.push_str("display:grid;grid-template-columns:repeat(4,1fr);"),
            0x60 => css.push_str("align-items:flex-start;"),
            0x70 => css.push_str("align-items:center;"),
            0x80 => css.push_str("align-items:flex-end;"),
            0x90 => css.push_str("align-items:stretch;"),
            0xA0 => css.push_str("justify-content:flex-start;"),
            0xB0 => css.push_str("justify-content:center;"),
            0xC0 => css.push_str("justify-content:flex-end;"),
            0xD0 => css.push_str("justify-content:space-between;"),
            0xE0 => css.push_str("justify-content:space-around;"),
            0xF0 => css.push_str("justify-content:space-evenly;"),
            _    => {}
        }

        // Border radius (bits 8-11)
        match bitmask & 0xF00 {
            0x100 => css.push_str("border-radius:2px;"),
            0x200 => css.push_str("border-radius:4px;"),
            0x300 => css.push_str("border-radius:6px;"),
            0x400 => css.push_str("border-radius:8px;"),
            0x500 => css.push_str("border-radius:12px;"),
            0x600 => css.push_str("border-radius:16px;"),
            0x700 => css.push_str("border-radius:9999px;"),
            _     => {}
        }

        // Gap (bits 12-15)
        match bitmask & 0xF000 {
            0x1000 => css.push_str("gap:0.25rem;"),
            0x2000 => css.push_str("gap:0.5rem;"),
            0x3000 => css.push_str("gap:1rem;"),
            0x4000 => css.push_str("gap:1.5rem;"),
            0x5000 => css.push_str("gap:2rem;"),
            _      => {}
        }

        // Width (bits 16-19)
        match bitmask & 0xF0000 {
            0x10000 => css.push_str("width:100%;"),
            0x20000 => css.push_str("width:100vw;"),
            0x30000 => css.push_str("width:fit-content;"),
            0x40000 => css.push_str("width:min-content;"),
            0x50000 => css.push_str("width:max-content;"),
            _       => {}
        }

        // Overflow (bits 20-23)
        match bitmask & 0xF00000 {
            0x100000 => css.push_str("overflow:hidden;"),
            0x200000 => css.push_str("overflow:auto;"),
            0x300000 => css.push_str("overflow:scroll;"),
            _        => {}
        }

        let result = if css.is_empty() {
            String::new()
        } else {
            format!(".nx-m-{:X}{{{}}}", bitmask, css)
        };

        self.cache.insert(bitmask, result.clone());
        result
    }

    /// Returns the CSS class name for a bitmask (without generating the rule).
    #[wasm_bindgen]
    pub fn class_name(bitmask: u32) -> String {
        format!("nx-m-{:X}", bitmask)
    }

    /// Clears the internal compilation cache.
    #[wasm_bindgen]
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
}
