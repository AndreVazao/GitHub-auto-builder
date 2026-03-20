export class PathValidator {
  static VALID_EXTENSIONS = new Set([
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.json',
    '.md',
    '.css',
    '.scss',
    '.html',
    '.py',
    '.java',
    '.kt',
    '.xml',
    '.yml',
    '.yaml',
    '.txt'
  ]);

  static FORBIDDEN_CHARS = /[<>:"|?*\x00-\x1F]/g;

  static normalizePath(input) {
    return String(input || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }

  static validatePathSyntax(filePath) {
    const errors = [];
    const warnings = [];
    const sanitizedPath = this.normalizePath(filePath);

    if (!sanitizedPath) {
      errors.push('Path vazio');
      return { isValid: false, errors, warnings, sanitizedPath };
    }

    if (sanitizedPath.includes('..')) {
      errors.push('Path não pode conter ".."');
    }

    if (this.FORBIDDEN_CHARS.test(sanitizedPath)) {
      errors.push('Path contém caracteres proibidos');
    }

    const segments = sanitizedPath.split('/').filter(Boolean);
    if (segments.length > 8) {
      warnings.push(`Path profundo (${segments.length} níveis)`);
    }

    const fileName = segments[segments.length - 1] || '';
    if (!fileName.includes('.')) {
      warnings.push('Arquivo sem extensão');
    } else {
      const extension = '.' + fileName.split('.').pop().toLowerCase();
      if (!this.VALID_EXTENSIONS.has(extension)) {
        warnings.push(`Extensão incomum: ${extension}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedPath
    };
  }

  static extractFileEntries(text) {
    const source = String(text || '');
    const markerRegex = /\/\/\s*FILE:\s*([^\n\r]+)/g;
    const markers = [];

    let match;
    while ((match = markerRegex.exec(source)) !== null) {
      markers.push({
        fullMatch: match[0],
        rawPath: match[1].trim(),
        start: match.index,
        afterMarkerIndex: markerRegex.lastIndex
      });
    }

    if (!markers.length) {
      return [];
    }

    const entries = [];

    for (let i = 0; i < markers.length; i += 1) {
      const current = markers[i];
      const next = markers[i + 1];
      const chunk = source.slice(
        current.afterMarkerIndex,
        next ? next.start : source.length
      );

      const fencedCodeMatch = chunk.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
      const code = fencedCodeMatch ? fencedCodeMatch[1].trim() : chunk.trim();

      const validation = this.validatePathSyntax(current.rawPath);

      entries.push({
        path: validation.sanitizedPath,
        rawPath: current.rawPath,
        code,
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    return entries.filter((entry) => entry.code && entry.path);
  }
      }
