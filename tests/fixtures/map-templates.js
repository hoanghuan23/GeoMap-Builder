// Deliberately different typography across themes catches frontend hardcoding.
export const mapTemplates = ['light', 'dark'].map(theme => ({
  id: 'vnexpress', theme, name: `VnExpress - ${theme}`, description: `Fixture ${theme}`,
  styles: {
    colors: theme === 'light'
      ? { background: '#FFFFFF', surface: '#FFFFFF', text: '#222222', textSecondary: '#666666', border: '#DDDDDD', accent: '#D77A99' }
      : { background: '#1C1C26', surface: '#1C1C26', text: '#E5E7EB', textSecondary: '#8790A3', border: '#343847', accent: '#D77A99' },
    layout: { borderRadius: theme === 'light' ? '10px' : '14px', spacing: '12px' }
  },
  typography: {
    fontFamily: theme === 'light' ? 'Arial, Helvetica, sans-serif' : 'Georgia, serif',
    headingFontFamily: theme === 'light' ? 'Merriweather, Georgia, serif' : 'Verdana, sans-serif',
    sizes: { body: '16px', popup: theme === 'light' ? '14px' : '15px', legend: '13px', label: '12px', heading: '20px', title: '24px' },
    weights: { normal: 400, semibold: 600, bold: 700 }, lineHeight: 1.55
  }
}));
