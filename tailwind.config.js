/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './layouts/**/*.html', 
    './content/**/*.md',
    './assets/css/**/*.css',
    './assets/js/**/*.js',
    './static/js/**/*.js'
  ],
  theme: {
    extend: {
      // === COULEURS MAPPÉES SUR VOTRE NOUVEAU SYSTÈME ===
      colors: {
        // Système principal (mappé sur vos variables CSS)
        primary: {
          DEFAULT: 'var(--primary)',           // #EA580C
          light: 'var(--primary-light)',      // #FB7C47  
          dark: 'var(--primary-dark)',        // #C2410C
        },
        
        // Système neutral (mappé sur votre nouveau système)
        neutral: {
          50: 'var(--neutral-50)',            // #FFFFFF
          100: 'var(--neutral-100)',          // #F7F0D8
          700: 'var(--neutral-700)',          // #52525B
          800: 'var(--neutral-800)',          // #27272A
          900: 'var(--neutral-900)',          // #18181B
        },
        
        // Garder les alias sémantiques
        'color-text': 'var(--color-text)',
        'color-text-secondary': 'var(--color-text-secondary)',
        'color-text-muted': 'var(--color-text-muted)',
        'color-bg': 'var(--color-bg)',
        'color-bg-alt': 'var(--color-bg-alt)',
        'color-border': 'var(--color-border)',
      },
      
      // === ESPACEMENTS MAPPÉS ===
      spacing: {
        '0': 'var(--space-0)',
        '1': 'var(--space-1)',        // 4px
        '2': 'var(--space-2)',        // 8px
        '3': 'var(--space-3)',        // 12px
        '4': 'var(--space-4)',        // 16px
        '5': 'var(--space-5)',        // 20px
        '6': 'var(--space-6)',        // 24px
        '8': 'var(--space-8)',        // 32px
        '10': 'var(--space-10)',      // 40px
        '12': 'var(--space-12)',      // 48px
        '16': 'var(--space-16)',      // 64px
        '20': 'var(--space-20)',      // 80px
        '24': 'var(--space-24)',      // 96px
      },
      
      // === RAYONS MAPPÉS ===
      borderRadius: {
        'none': 'var(--radius-none)',
        'sm': 'var(--radius-sm)',
        'md': 'var(--radius-md)', 
        'lg': 'var(--radius-lg)',
        'xl': 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
        'full': 'var(--radius-full)',
      },
      
      // === OMBRES MAPPÉES ===
      boxShadow: {
        'xs': 'var(--shadow-xs)',
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
        'primary': 'var(--shadow-primary)',
        'primary-lg': 'var(--shadow-primary-lg)',
      },
      
      // === Z-INDEX MAPPÉS ===
      zIndex: {
        'base': 'var(--z-base)',
        'dropdown': 'var(--z-dropdown)',
        'sticky': 'var(--z-sticky)',
        'fixed': 'var(--z-fixed)',
        'overlay': 'var(--z-overlay)',
        'modal': 'var(--z-modal)',
        'popover': 'var(--z-popover)',
        'tooltip': 'var(--z-tooltip)',
        'notification': 'var(--z-notification)',
        'maximum': 'var(--z-maximum)',
      },
      
      // === TYPOGRAPHIE ===
      fontFamily: {
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
      },
      
      fontSize: {
        'xs': 'var(--text-xs)',
        'sm': 'var(--text-sm)', 
        'base': 'var(--text-base)',
        'lg': 'var(--text-lg)',
        'xl': 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
        '3xl': 'var(--text-3xl)',
        '4xl': 'var(--text-4xl)',
        '5xl': 'var(--text-5xl)',
        '6xl': 'var(--text-6xl)',
        '7xl': 'var(--text-7xl)',
        '8xl': 'var(--text-8xl)',
      },
      
      // === TRANSITIONS ===
      transitionDuration: {
        'fast': '150ms',
        'base': '300ms', 
        'slow': '500ms',
      },
      
      transitionTimingFunction: {
        'default': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      
      // === LAYOUT ===
      maxWidth: {
        'container': 'var(--container-max)',
      },
      
      // === ANIMATIONS PERSONNALISÉES ===
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      
      animation: {
        breathe: 'breathe 8s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite',
        'fade-in-down': 'fade-in-down 1s ease-out forwards',
        'fade-in-up': 'fade-in-up 1s ease-out forwards',
        'scale-in': 'scale-in 0.5s ease-out forwards',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function({ addUtilities }) {
      addUtilities({
        // Animation delays
        '.animation-delay-100': { 'animation-delay': '0.1s' },
        '.animation-delay-200': { 'animation-delay': '0.2s' },
        '.animation-delay-300': { 'animation-delay': '0.3s' },
        '.animation-delay-500': { 'animation-delay': '0.5s' },
        '.animation-delay-1000': { 'animation-delay': '1s' },
        
        // États d'interaction (non redondants avec votre CSS)
        '.scroll-smooth': { 'scroll-behavior': 'smooth' },
      });
    },
  ],
};
