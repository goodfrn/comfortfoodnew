/**
 * Cloudflare Worker Multi-Sites - Version CORRIGÉE
 * 
 * ✅ CORS sécurisé pour domaines personnalisés
 * ✅ Détection repo via registry 
 * ✅ Gestion domaines normalisée
 * ✅ Auto-modification sécurisée 
 */

// ===================================================================
// UTILITAIRES POUR REMPLACER Buffer
// ===================================================================

function stringToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToString(base64) {
  return decodeURIComponent(escape(atob(base64)));
}

/**
 * Normalise un domaine en format HTTPS avec trailing slash
 * ✅ CORRIGÉ : Fonction unifiée pour éviter les incohérences
 */
function normaliseDomain(raw) {
  if (!raw || typeof raw !== 'string') {
    return '';
  }
  
  let url = raw.trim()
    .replace(/^https?:\/\//, '')  // Enlever schéma existant
    .replace(/\/+$/, '');         // Enlever trailing slashes multiples
  
  // Retourner avec HTTPS et un seul trailing slash
  return `https://${url}/`;
}

/**
 * ✅ NOUVEAU : Normalise pour comparaisons (sans trailing slash)
 */
function normaliseForComparison(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '')
            .replace(/\/+$/, '')
            .toLowerCase();
}

async function findRepoVariant(baseName, githubToken, repoOwner) {
  console.log(`🔍 Recherche repo pour: ${baseName}`);
  
  // Test 1: nom exact
  console.log(`📝 Test 1: ${baseName}`);
  let result = await getSiteConfigFromGitHub(baseName, githubToken, repoOwner);
  if (result.success) {
    console.log(`✅ Trouvé avec nom exact: ${baseName}`);
    return { repoName: baseName, ...result };
  }
  console.log(`❌ Échec nom exact: ${result.error}`);
  
  // Test 2: recettes-blog-test → recettes-blog_test (cas spécial)
  if (baseName === 'recettes-blog-test') {
    console.log(`📝 Test 2: recettes-blog_test (cas spécial)`);
    result = await getSiteConfigFromGitHub('recettes-blog_test', githubToken, repoOwner);
    if (result.success) {
      console.log(`✅ Trouvé avec variante spéciale: recettes-blog_test`);
      return { repoName: 'recettes-blog_test', ...result };
    }
    console.log(`❌ Échec variante spéciale: ${result.error}`);
  }
  
  // Test 3: _ au lieu de -
  const underscoreVariant = baseName.replace(/-/g, '_');
  if (underscoreVariant !== baseName) {
    console.log(`📝 Test 3: ${underscoreVariant}`);
    result = await getSiteConfigFromGitHub(underscoreVariant, githubToken, repoOwner);
    if (result.success) {
      console.log(`✅ Trouvé avec underscore: ${underscoreVariant}`);
      return { repoName: underscoreVariant, ...result };
    }
    console.log(`❌ Échec underscore: ${result.error}`);
  }
  
  return { 
    success: false, 
    error: `Repository "${baseName}" (et variantes) non trouvé` 
  };
}

// ===================================================================
// CONFIGURATION
// ===================================================================

const CONFIG = {
  BRANCH: 'main',
  ALLOWED_ORIGINS: [
    'https://recettes-blog-test.pages.dev',
    'http://localhost:1313'
  ],
  USER_AGENT: 'Multi-Site-Worker/2.3'
};

// ===================================================================
// 🔧 FIX 1 : DÉTECTION REPO VIA REGISTRY
// ===================================================================

/**
 * ✅ CORRIGÉ : Détection repo intelligente via registry
 */
async function getSourceRepo(request, env) {
  const origin = request.headers.get('Origin');
  console.log(`🔍 Détection repo pour origin: ${origin}`);
  
  if (!origin) {
    console.log('❌ Pas d\'origin, fallback vers repo principal');
    return 'recettes-blog_test';
  }
  
  // 🎯 PRIORITÉ 1 : Chercher dans le registry
  try {
    const sites = await getSitesFromRegistry(env);
    console.log(`📋 Registry contient ${Object.keys(sites).length} sites`);
    
    const matchingSite = Object.values(sites).find(site => {
      const siteUrlNormalized = normaliseForComparison(site.deployment_url);
      const originNormalized = normaliseForComparison(origin);
      
      console.log(`🔍 Comparaison: ${siteUrlNormalized} vs ${originNormalized}`);
      
      // Match exact sur deployment_url
      if (siteUrlNormalized === originNormalized) {
        console.log(`✅ Match exact via deployment_url`);
        return true;
      }
      
      // Match sur domaine avec variations
      if (site.domain) {
        const domainVariations = [
          normaliseForComparison(`https://${site.domain}`),
          normaliseForComparison(`https://${site.domain}/`),
          normaliseForComparison(site.domain),
          normaliseForComparison(`https://www.${site.domain}`), // ✅ AJOUT
          normaliseForComparison(`https://www.${site.domain}/`), // ✅ AJOUT
          normaliseForComparison(`www.${site.domain}`) // ✅ AJOUT
        ];
        
        if (domainVariations.includes(originNormalized)) {
          console.log(`✅ Match via domaine`);
          return true;
        }
      }
      
      return false;
    });
    
    if (matchingSite) {
      // Extraire le nom du repo depuis "owner/repo-name"
      const repoName = matchingSite.repo.split('/').pop();
      console.log(`✅ Repo trouvé via registry: ${repoName}`);
      return repoName;
    }
    
    console.log('⚠️ Aucun site trouvé dans le registry');
  } catch (error) {
    console.warn('❌ Erreur lecture registry:', error);
  }
  
  // 🎯 PRIORITÉ 2 : Fallback intelligent sur hostname
  const hostname = origin.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  console.log(`🔍 Fallback hostname: ${hostname}`);
  
  // Cas spécial pour le site mère
  if (hostname.includes('recettes-blog-test')) {
    console.log('✅ Site mère détecté');
    return 'recettes-blog_test';
  }
  
  // Extraction nom du domaine principal
  const domainParts = hostname.split('.');
  const siteName = domainParts[0];
  
  console.log(`🎯 Nom extrait: ${siteName}`);
  return siteName;
}

// ===================================================================
// 🔧 FIX 2 : CORS SÉCURISÉ POUR DOMAINES PERSONNALISÉS
// ===================================================================

/**
 * ✅ CORRIGÉ : CORS avec vérifications sécurisées
 */
async function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  console.log(`🌐 CORS check pour: ${origin}`);
  
  // 🎯 PRIORITÉ 1 : Domaines prédéfinis (toujours autorisés)
  if (CONFIG.ALLOWED_ORIGINS.includes(origin)) {
    console.log('✅ Origin autorisé (liste prédéfinie)');
    return createCorsResponse(origin);
  }
  
  // 🎯 PRIORITÉ 2 : Vérification dans le registry
  try {
    const sites = await getSitesFromRegistry(env);
    console.log(`📋 Vérification CORS dans ${Object.keys(sites).length} sites`);
    
    const isRegisteredSite = Object.values(sites).some(site => {
      const originNormalized = normaliseForComparison(origin);
      
      // Match exact sur deployment_url
      if (normaliseForComparison(site.deployment_url) === originNormalized) {
        console.log(`✅ CORS autorisé via deployment_url: ${site.deployment_url}`);
        return true;
      }
      
      // Match exact sur domaine (avec variations sécurisées)
      if (site.domain) {
        const domainVariations = [
          normaliseForComparison(`https://${site.domain}`),
          normaliseForComparison(`https://${site.domain}/`),
          normaliseForComparison(`https://www.${site.domain}`), // ✅ AJOUT
          normaliseForComparison(`https://www.${site.domain}/`) // ✅ AJOUT
        ];
        
        if (domainVariations.includes(originNormalized)) {
          console.log(`✅ CORS autorisé via domaine: ${site.domain}`);
          return true;
        }
      }
      
      return false;
    });
    
    if (isRegisteredSite) {
      return createCorsResponse(origin);
    }
    
    console.log('❌ Origin non trouvé dans le registry');
  } catch (error) {
    console.warn('❌ Erreur vérification registry CORS:', error);
  }
  
  // 🎯 PRIORITÉ 3 : Fallback sécurisé (premier domaine autorisé)
  console.log('⚠️ Utilisation fallback CORS');
  return createCorsResponse(CONFIG.ALLOWED_ORIGINS[0]);
}

/**
 * ✅ NOUVEAU : Helper pour créer réponse CORS uniforme
 */
function createCorsResponse(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// ===================================================================
// LISTE DES CHAMPS SÉCURISÉS (inchangée)
// ===================================================================

const SAFE_FIELDS = [
  'baseURL',
  // 🏷️ SITE (6 champs)
  'site.name', 'site.tagline', 'site.description', 'site.author', 'site.email', 'site.language',
  
  // 🧭 NAVIGATION (10 champs)
  'navigation.menu_items.home', 
  'navigation.menu_items.recipes', 
  'navigation.menu_items.categories', 
  'navigation.menu_items.about', 
  'navigation.menu_items.contact',
  'navigation.page_titles.home',
  'navigation.page_titles.recipes',
  'navigation.page_titles.categories',
  'navigation.page_titles.about',
  'navigation.page_titles.contact',
  
  // 🎨 BRANDING (3 champs)
  'branding.logo_text', 
  
  // 🌈 COLORS (6 champs)
  'colors.primary', 'colors.primary_dark', 'colors.primary_light', 'colors.secondary', 'colors.background', 'colors.text',
  'colors.brand_color',
  
  // 📱 SOCIAL (4 champs URLs)
  'social.facebook', 'social.instagram', 'social.twitter', 'social.pinterest', 
  
  // 📱 SOCIAL DESCRIPTIONS (3 champs dans footer)
  'footer.social_descriptions.pinterest',
  'footer.social_descriptions.instagram', 
  'footer.social_descriptions.facebook',
  
  // 🔍 HEADER (4 champs)
  'header.search_placeholder', 'header.search_placeholder_mobile', 'header.follow_button_text', 'header.menu_aria_label',
  
  // 🏠 HERO (6 champs)
  'hero.badge_text', 'hero.title_line1', 'hero.title_line2', 'hero.subtitle', 'hero.subtitle_highlight', 'hero.cta_primary_text', 
  'hero.cta_secondary_text',
  
  // 📋 HOMEPAGE (9 champs)
  'homepage.latest_recipes.title', 'homepage.latest_recipes.description', 'homepage.popular_recipes.title', 
  'homepage.popular_recipes.empty_message', 'homepage.categories_section.title', 'homepage.newsletter.title', 
  'homepage.newsletter.description', 'homepage.newsletter.email_placeholder', 'homepage.newsletter.button_text',
  
  // 👤 ABOUT SECTION (8 champs existants)
  'about_section.chef_name', 
  'about_section.image_alt', 
  
  // 👤 ABOUT PAGE (2 champs nouveaux)
  'about_page.title',
  'about_page.meta_description',
  
  // 📄 PAGES & LISTES (8 champs)
  'list_pages.recipes_title', 'list_pages.recipes_description', 'list_pages.categories_title_prefix', 'list_pages.no_recipes',
  'list_pages.breadcrumb.home',
  'list_pages.breadcrumb.categories',
  'categories_page.title',
  'tags_page.all_tags_title',
  
  // 🦶 FOOTER (15 champs)
  'footer.description', 'footer.navigation_title', 'footer.categories_title', 'footer.social_title',
  'footer.newsletter_title', 'footer.newsletter_description', 'footer.newsletter_placeholder', 'footer.newsletter_button', 
  'footer.copyright_tagline', 'footer.copyright_prefix', 'footer.copyright_suffix', 'footer.scroll_top_label',
  'footer.legal_links_text.privacy', 'footer.legal_links_text.terms', 'footer.legal_links_text.legal', 'footer.legal_links_text.contact',

  // 🍽️ RECIPE PAGE (section complète à ajouter)
  'recipe_page.author_prefix', 'recipe_page.published_prefix', 'recipe_page.sections.ingredients', 'recipe_page.sections.instructions',
  'recipe_page.sections.tips', 'recipe_page.sections.faq', 'recipe_page.chef_note_title', 'recipe_page.about_sidebar_title', 'recipe_page.about_sidebar_text', 
  'recipe_page.sectionsTitle.ingredients_note', 'recipe_page.sectionsTitle.instructions_note', 'recipe_page.sectionsTitle.keywords',
  'recipe_page.nutritionSection.title', 'recipe_page.nutritionSection.subtitle', 'recipe_page.nutritionLabels.calories',
  'recipe_page.nutritionLabels.proteinContent', 'recipe_page.nutritionLabels.carbohydrateContent', 'recipe_page.nutritionLabels.fatContent',
  'recipe_page.sections.related', 'recipe_page.sections.discover', 'recipe_page.sections.view_all_recipes', 'recipe_page.summary_labels.prep', 
  'recipe_page.summary_labels.cook', 'recipe_page.summary_labels.total', 'recipe_page.summary_labels.servings', 'recipe_page.summary_labels.cuisine',
  
  // 🔍 SEARCH COMPONENTS (4 champs)
  'components.search.no_results', 'components.search.loading', 'components.search.clear_label', 'components.search.no_results_emoji',

  // 🏷️ SYSTÈME DE CATÉGORIES (version simple)
  'categories_system.site_type',
  'categories_system.main_section', 
  'categories_system.section_title',
  
  // 📞 CONTACT (6 champs)
  'contact_page.title',
  'contact_page.subtitle', 
  'contact_page.form.name_label', 
  'contact_page.form.email_label', 
  'contact_page.form.message_label',
  'contact_page.form.submit_button',
  
  // 🏷️ TAGS PAGES (2 champs)
  'tags_page.title_prefix',
  'tags_page.no_recipes',

  // 📄 PAGES LÉGALES (3 champs)
  'legal_pages.mentions_legales.content',
  'legal_pages.politique_confidentialite.content', 
  'legal_pages.conditions_utilisation.content'
];

// ===================================================================
// POINT D'ENTRÉE PRINCIPAL
// ===================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = await getCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const response = await routeRequest(url, request, env, corsHeaders);
      return response;
    } catch (error) {
      console.error('Erreur générale:', error);
      return jsonResponse(
        { error: 'Erreur serveur interne', details: error.message }, 
        500, 
        corsHeaders
      );
    }
  }
};

// ===================================================================
// ROUTAGE
// ===================================================================

async function routeRequest(url, request, env, corsHeaders) {
  switch (url.pathname) {
    case '/api/health':
      return jsonResponse({
        status: 'ok',
        timestamp: new Date().toISOString(),
        method: 'template-api',
        version: '2.3-fixed',
        safe_fields_count: SAFE_FIELDS.length
      }, 200, corsHeaders);
      
    case '/api/clone-site':
      return handleCloneSite(request, env, corsHeaders);
      
    case '/api/list-sites':
      return handleListSites(request, env, corsHeaders);

    case '/api/delete-site':
      return handleDeleteSite(request, env, corsHeaders);

    case '/api/update-config':
      return handleUpdateConfig(request, env, corsHeaders);
      
    case '/api/get-config':
      return handleGetConfig(request, env, corsHeaders);
      
    case '/api/list-domains':
      return handleListDomains(request, env, corsHeaders);

    case '/api/list-articles':
      return handleListArticles(request, env, corsHeaders);
      
    case '/api/get-article':
      return handleGetArticle(request, env, corsHeaders);
      
    case '/api/save-article':
      return handleSaveArticle(request, env, corsHeaders);

      
    case '/api/articles-count':
      return handleArticlesCount(request, env, corsHeaders);    

      
    default:
      return jsonResponse({ error: 'Route non trouvée' }, 404, corsHeaders);
  }
}

// ===================================================================
// ✅ ENDPOINT GET CONFIG AMÉLIORÉ
// ===================================================================

async function handleGetConfig(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const origin = request.headers.get('Origin');
    
    if (!origin) {
      return jsonResponse({ error: 'Origin manquant' }, 400, corsHeaders);
    }
    
    console.log(`📥 GET CONFIG pour origin: ${origin}`);
    
    const { GITHUB_TOKEN, REPO_OWNER } = env;
    if (!GITHUB_TOKEN || !REPO_OWNER) {
      return jsonResponse({
        error: 'Variables d\'environnement GitHub manquantes'
      }, 500, corsHeaders);
    }
    
    // ✅ CORRIGÉ : Utilise la nouvelle détection de repo
    const targetRepo = await getSourceRepo(request, env);
    console.log(`🎯 Repo détecté: ${targetRepo}`);
    
    const configResult = await findRepoVariant(targetRepo, GITHUB_TOKEN, REPO_OWNER);
    
    if (configResult.success) {
      return jsonResponse({
        success: true,
        site_id: targetRepo,
        config: configResult.config,
        fields_count: Object.keys(configResult.config).length,
        message: 'Configuration récupérée avec succès',
        detected_repo: targetRepo
      }, 200, corsHeaders);
    } else {
      return jsonResponse({
        success: false,
        error: configResult.error,
        site_id: targetRepo,
        detected_repo: targetRepo
      }, 404, corsHeaders);
    }
    
  } catch (error) {
    console.error('❌ Erreur handleGetConfig:', error);
    return jsonResponse({ 
      error: 'Erreur serveur: ' + error.message 
    }, 500, corsHeaders);
  }
}


// ===================================================================
// 🆕 LECTURE DES FICHIERS MARKDOWN SÉPARÉS
// ===================================================================

async function loadMarkdownContent(repoName, githubToken, repoOwner) {
  console.log(`📄 Chargement des fichiers Markdown pour ${repoName}...`);
  
  const markdownFields = {
    'legal_pages.mentions_legales.content': 'content/mentions-legales.md',
    'legal_pages.politique_confidentialite.content': 'content/politique-confidentialite.md',
    'legal_pages.conditions_utilisation.content': 'content/conditions-utilisation.md'
  };
  
  const markdownConfig = {};
  
  for (const [fieldName, filePath] of Object.entries(markdownFields)) {
    try {
      const fileUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
      
      const response = await fetch(fileUrl, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/vnd.github.v3.raw'
        }
      });
      
      if (response.ok) {
        const markdownContent = await response.text();
        
        // Extraire seulement le contenu (après le front matter)
        const contentMatch = markdownContent.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
        const cleanContent = contentMatch ? contentMatch[1].trim() : markdownContent.trim();
        
        if (cleanContent) {
          markdownConfig[fieldName] = cleanContent;
          console.log(`✅ ${fieldName} chargé (${cleanContent.length} caractères)`);
        }
      } else {
        console.log(`⚠️ ${filePath} non trouvé (404) - normal pour un nouveau site`);
      }
      
    } catch (error) {
      console.warn(`⚠️ Erreur lecture ${filePath}:`, error.message);
    }
  }
  
  console.log(`📄 ${Object.keys(markdownConfig).length} fichiers Markdown chargés`);
  return markdownConfig;
}


async function getSiteConfigFromGitHub(repoName, githubToken, repoOwner) {
  const configUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/data/config.yaml`;
  
  try {
    console.log(`📝 Récupération config.yaml pour ${repoName}...`);
    
    const response = await fetch(configUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: `Repository "${repoName}" ou fichier config.yaml non trouvé`
        };
      }
      return {
        success: false,
        error: `Erreur GitHub API: ${response.status}`
      };
    }
    
    const yamlContent = await response.text();
    console.log('📄 Contenu YAML récupéré, extraction des champs sécurisés...');
    
    // ✅ EXISTANT : Parser le YAML
    const safeConfig = parseYamlToSafeFields(yamlContent);
    
    // 🆕 NOUVEAU : Charger les fichiers Markdown
    const markdownConfig = await loadMarkdownContent(repoName, githubToken, repoOwner);
    
    // 🆕 FUSION : Combiner YAML + Markdown
    const finalConfig = { ...safeConfig, ...markdownConfig };
    
    console.log(`✅ ${Object.keys(safeConfig).length} champs YAML + ${Object.keys(markdownConfig).length} champs Markdown = ${Object.keys(finalConfig).length} total`);
    
    return {
      success: true,
      config: finalConfig
    };
    
  } catch (error) {
    console.error('❌ Erreur getSiteConfigFromGitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===================================================================
// PARSER YAML (inchangé)
// ===================================================================

function parseYamlToSafeFields(yamlContent) {
  const config = {};
  const lines = yamlContent.split('\n');
  
  let currentSection = '';
  let currentSubsection = '';
  let currentSubSubsection = '';
  
  lines.forEach(line => {
    const trimmedLine = line.trim();
    
    // Ignorer commentaires et lignes vides
    if (!trimmedLine || trimmedLine.startsWith('#')) return;
    
    // Calculer le niveau d'indentation
    const indentLevel = line.length - line.trimStart().length;
    
    // Section principale (0 espaces)
    if (indentLevel === 0 && trimmedLine.endsWith(':') && !trimmedLine.includes(' ')) {
      currentSection = trimmedLine.replace(':', '');
      currentSubsection = '';
      currentSubSubsection = '';
      return;
    }
    
    // Sous-section (2 espaces)
    if (indentLevel === 2 && trimmedLine.endsWith(':') && !trimmedLine.includes(' ')) {
      currentSubsection = trimmedLine.replace(':', '');
      currentSubSubsection = '';
      return;
    }
    
    // Sous-sous-section (4 espaces)
    if (indentLevel === 4 && trimmedLine.endsWith(':') && !trimmedLine.includes(' ')) {
      currentSubSubsection = trimmedLine.replace(':', '');
      return;
    }
    
    // Ligne avec valeur
    if (trimmedLine.includes(':')) {
      const colonIndex = trimmedLine.indexOf(':');
      const key = trimmedLine.substring(0, colonIndex).trim();
      let value = trimmedLine.substring(colonIndex + 1).trim();
      
      // Nettoyer la valeur - SUPPRIMER LES COMMENTAIRES
      if (value.includes('#') && !value.trim().startsWith('#')) {
        value = value.split('#')[0].trim();
      }
            
      // Enlever les guillemets
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      
      // Construire le nom du champ selon le niveau
      let fieldName = '';
      if (currentSubSubsection) {
        fieldName = `${currentSection}.${currentSubsection}.${currentSubSubsection}.${key}`;
      } else if (currentSubsection) {
        fieldName = `${currentSection}.${currentSubsection}.${key}`;
      } else if (currentSection) {
        fieldName = `${currentSection}.${key}`;
      }
      
      // Ajouter seulement si autorisé et non vide
      if (fieldName && SAFE_FIELDS.includes(fieldName) && value) {
        config[fieldName] = value;
        console.log(`✓ Extrait: ${fieldName} = ${value}`);
      }
    }
  });
  
  return config;
}

// ===================================
// 🔧 FIX 3 : ENDPOINT UPDATE CONFIG SÉCURISÉ
// ===================================================================

async function handleUpdateConfig(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const origin = request.headers.get('Origin');
    const data = await request.json();
    
    console.log('🔍 DEBUG handleUpdateConfig:');
    console.log('Origin:', origin);
    console.log('Data reçue:', Object.keys(data));
    
    // ✅ CORRIGÉ : Utilise la nouvelle détection de repo
    const detectedRepo = await getSourceRepo(request, env);
    const targetRepo = data.repo_name || detectedRepo;
    
    console.log('Repo détecté:', detectedRepo);
    console.log('Target repo:', targetRepo);
    
    // ✅ SÉCURITÉ : Vérification stricte de l'autorisation
    if (detectedRepo && targetRepo && detectedRepo !== targetRepo) {
      console.log('❌ Accès refusé:', detectedRepo, '!=', targetRepo);
      return jsonResponse({
        error: `Accès refusé: le site détecté (${detectedRepo}) ne peut pas modifier ${targetRepo}`,
        detected_repo: detectedRepo,
        requested_repo: targetRepo
      }, 403, corsHeaders);
    }
    
    if (!targetRepo) {
      return jsonResponse({
        error: 'Impossible de déterminer le site cible',
        detected_repo: detectedRepo
      }, 400, corsHeaders);
    }
    
    console.log('✅ Autorisation accordée pour:', targetRepo);
    
    const { GITHUB_TOKEN, REPO_OWNER } = env;
    if (!GITHUB_TOKEN || !REPO_OWNER) {
      return jsonResponse({
        error: 'Variables d\'environnement GitHub manquantes'
      }, 500, corsHeaders);
    }
    
    const safeUpdates = filterSafeUpdates(data);
    
    if (Object.keys(safeUpdates).length === 0) {
      return jsonResponse({
        error: 'Aucun champ autorisé dans les mises à jour',
        allowed_fields: SAFE_FIELDS.length
      }, 400, corsHeaders);
    }
    
    console.log(`🔒 ${Object.keys(safeUpdates).length} champs sécurisés validés`);
    
    const updateResult = await updateSiteConfig(targetRepo, safeUpdates, GITHUB_TOKEN, REPO_OWNER);
    
    if (updateResult.success) {
      return jsonResponse({
        success: true,
        message: `Configuration de ${targetRepo} mise à jour avec succès`,
        files_updated: updateResult.files_updated || [],
        fields_processed: updateResult.fields_processed || 0,
        detected_repo: detectedRepo
      }, 200, corsHeaders);
    } else {
      return jsonResponse({
        error: updateResult.error || 'Erreur lors de la mise à jour',
        detected_repo: detectedRepo
      }, 500, corsHeaders);
    }
    
  } catch (error) {
    console.error('❌ Erreur handleUpdateConfig:', error);
    return jsonResponse({ 
      error: 'Erreur serveur: ' + error.message 
    }, 500, corsHeaders);
  }
}

// ===================================================================
// VALIDATION ET MISE À JOUR (inchangées)
// ===================================================================

function filterSafeUpdates(updates) {
  const safeUpdates = {};
  const rejectedFields = [];
  
  Object.entries(updates).forEach(([fieldName, value]) => {
    if (SAFE_FIELDS.includes(fieldName)) {
      if (value && typeof value === 'string' && value.trim()) {
        // Nettoyer la valeur des caractères parasites
        const cleanValue = value.trim()
          .replace(/\\"/g, '"')  // Enlever les échappements
          .replace(/^"*|"*$/g, '') // Enlever guillemets multiples
          .replace(/([^"])#.*$/, '$1'); // Enlever commentaires
        
        safeUpdates[fieldName] = cleanValue;
      }
    } else {
      rejectedFields.push(fieldName);
    }
  });
  
  if (rejectedFields.length > 0) {
    console.log(`🚫 ${rejectedFields.length} champs rejetés:`, rejectedFields);
  }
  
  console.log(`✅ ${Object.keys(safeUpdates).length} champs autorisés validés`);
  
  return safeUpdates;
}

async function updateSiteConfig(repoName, updates, githubToken, repoOwner) {
  console.log(`🔧 Mise à jour intelligente pour ${repoName}: ${Object.keys(updates).length} champs`);
  
  try {
    const filesUpdated = [];
    
    if (hasYamlUpdates(updates)) {
      // 🆕 Séparer les mises à jour légales des autres
      const legalUpdates = {};
      const yamlUpdates = {};
      
      Object.entries(updates).forEach(([key, value]) => {
        if (key.startsWith('legal_pages.') && key.endsWith('.content')) {
          legalUpdates[key] = value;
        } else {
          yamlUpdates[key] = value;
        }
      });
      
      // 🆕 Mettre à jour les fichiers .md
      if (Object.keys(legalUpdates).length > 0) {
        console.log('📝 Mise à jour fichiers Markdown...');
        const mdResult = await updateMarkdownFiles(repoName, legalUpdates, githubToken, repoOwner);
        if (mdResult.success) {
          filesUpdated.push(...mdResult.files_updated);
          console.log(`✅ ${mdResult.files_updated.length} fichiers Markdown mis à jour`);
        }
      }
      
      // Mettre à jour le YAML (pour les autres champs)
      if (Object.keys(yamlUpdates).length > 0) {
        console.log('📝 Mise à jour data/config.yaml...');
        const yamlResult = await updateYamlConfig(repoName, yamlUpdates, githubToken, repoOwner);
        if (yamlResult.success) {
          filesUpdated.push('data/config.yaml');
        } else {
          console.warn('⚠️ Échec mise à jour YAML:', yamlResult.error);
        }
      }
    }
    
    if (hasTomlUpdates(updates)) {
      console.log('📝 Mise à jour config.toml...');
      const tomlResult = await updateTomlConfig(repoName, updates, githubToken, repoOwner);
      if (tomlResult.success) {
        filesUpdated.push('config.toml');
      } else {
        console.warn('⚠️ Échec mise à jour TOML:', tomlResult.error);
      }
    }
    
    console.log(`✅ Configuration mise à jour: ${filesUpdated.join(', ')}`);
    
    return {
      success: true,
      files_updated: filesUpdated,
      fields_processed: Object.keys(updates).length
    };
    
  } catch (error) {
    console.error('❌ Erreur updateSiteConfig:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

function hasYamlUpdates(updates) {
  return SAFE_FIELDS.some(field => updates.hasOwnProperty(field));
}

function hasTomlUpdates(updates) {
  const tomlFields = ['site.name', 'site.language', 'baseURL'];
  return tomlFields.some(field => updates.hasOwnProperty(field));
}

async function updateYamlConfig(repoName, updates, githubToken, repoOwner) {
  const configUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/data/config.yaml`;
  
  try {
    console.log(`📝 Récupération config.yaml pour ${repoName}...`);
    
    const response = await fetch(configUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      throw new Error(`Impossible de récupérer config.yaml: ${response.status}`);
    }
    
    const fileData = await response.json();
    let content = base64ToString(fileData.content);
    
    console.log('📄 Application des mises à jour YAML...');
    content = applyYamlUpdatesOptimized(content, updates);
    
    console.log('💾 Sauvegarde des modifications...');
    const encodedContent = stringToBase64(content);
    
    const updateResponse = await fetch(configUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: JSON.stringify({
        message: '⚙️ Mise à jour configuration via admin',
        content: encodedContent,
        sha: fileData.sha
      })
    });
    
    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      throw new Error(`Erreur sauvegarde: ${error.message}`);
    }
    
    console.log('✅ data/config.yaml mis à jour avec succès');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Erreur updateYamlConfig:', error);
    return { success: false, error: error.message };
  }
}

// ===================================================================
// FONCTION YAML PARSER CORRIGÉE
// ===================================================================

function applyYamlUpdatesOptimized(content, updates) {
  console.log(`🔧 Application des mises à jour: ${Object.keys(updates).length} champs`);
  
  let updatedCount = 0;
  
  Object.entries(updates).forEach(([fieldName, value]) => {
    const oldContent = content;
    
    // Échapper les caractères spéciaux pour la regex ET l'arabe
    const cleanValue = value
      .replace(/\\/g, '\\\\')  // Échapper les backslashes
      .replace(/"/g, '\\"');   // Échapper les guillemets
    
    try {
      console.log(`🔍 Traitement: ${fieldName} = "${cleanValue}"`);
      
      if (fieldName.startsWith('colors.')) {
        // ✅ REGEX COULEURS CORRIGÉE - Gère avec ET sans guillemets
        const colorKey = fieldName.split('.').pop();
        const colorRegex = new RegExp(`(\\s+${colorKey}:\\s*)"?([^"\\n\\r]*)"?`, 'gm');
        content = content.replace(colorRegex, `$1"${cleanValue}"`);
        
      } else if (fieldName.startsWith('navigation.menu_items.')) {
        // ✅ REGEX NAVIGATION SPÉCIALISÉE - CORRIGÉE
        const menuKey = fieldName.split('.').pop();
        const navRegex = new RegExp(
          `(navigation:[\\s\\S]*?menu_items:[\\s\\S]*?\\s+${menuKey}:\\s*)"?([^"\\n\\r]*)"?`, 
          'gm'
        );
        content = content.replace(navRegex, `$1"${cleanValue}"`);
        
      } else if (fieldName.startsWith('homepage.')) {
        // ✅ REGEX HOMEPAGE SPÉCIALISÉE - NOUVELLE
        const parts = fieldName.split('.');
        const subsection = parts[1]; // latest_recipes, popular_recipes, etc.
        const key = parts[2]; // title, description, etc.
        
        const homepageRegex = new RegExp(
          `(homepage:[\\s\\S]*?${subsection}:[\\s\\S]*?\\s+${key}:\\s*)"?([^"\\n\\r]*)"?`,
          'gm'
        );
        content = content.replace(homepageRegex, `$1"${cleanValue}"`);
        
      } else if (fieldName.startsWith('footer.social_descriptions.')) {
        // ✅ REGEX SOCIAL DESCRIPTIONS SPÉCIALISÉE - NOUVELLE
        const socialKey = fieldName.split('.').pop();
        const socialRegex = new RegExp(
          `(footer:[\\s\\S]*?social_descriptions:[\\s\\S]*?\\s+${socialKey}:\\s*)"?([^"\\n\\r]*)"?`,
          'gm'
        );
        content = content.replace(socialRegex, `$1"${cleanValue}"`);
        
      } else if (fieldName.includes('.')) {
        // ✅ REGEX GÉNÉRALE AMÉLIORÉE - 4 NIVEAUX
        const parts = fieldName.split('.');
        const section = parts[0];
        const key = parts[parts.length - 1];
        
        if (parts.length === 4) {
          // 4 niveaux : footer.legal_links_text.privacy
          const subsection = parts[1];
          const subsubsection = parts[2];
          const level4Regex = new RegExp(
            `(${section}:[\\s\\S]*?${subsection}:[\\s\\S]*?${subsubsection}:[\\s\\S]*?\\s+${key}:\\s*)"?([^"\\n\\r]*)"?`,
            'gm'
          );
          content = content.replace(level4Regex, `$1"${cleanValue}"`);
          
        } else if (parts.length === 3) {
          // 3 niveaux : footer.social_descriptions.pinterest
          const subsection = parts[1];
          const level3Regex = new RegExp(
            `(${section}:[\\s\\S]*?${subsection}:[\\s\\S]*?\\s+${key}:\\s*)"?([^"\\n\\r]*)"?`,
            'gm'
          );
          content = content.replace(level3Regex, `$1"${cleanValue}"`);
          
        } else if (parts.length === 2) {
          // 2 niveaux : site.name
          const level2Regex = new RegExp(
            `(${section}:[\\s\\S]*?\\s+${key}:\\s*)"?([^"\\n\\r]*)"?`,
            'gm'
          );
          content = content.replace(level2Regex, `$1"${cleanValue}"`);
        }
        
      } else {
        // ✅ CHAMP SIMPLE (niveau racine)
        const simpleRegex = new RegExp(`(^\\s*${fieldName}:\\s*)"?([^"\\n\\r]*)"?`, 'gm');
        content = content.replace(simpleRegex, `$1"${cleanValue}"`);
      }
      
      // ✅ VÉRIFICATION DU CHANGEMENT
      if (content !== oldContent) {
        updatedCount++;
        console.log(`✅ ${fieldName} mis à jour avec succès`);
      } else {
        console.log(`⚠️ ${fieldName} non trouvé ou pas modifié`);
      }
      
    } catch (error) {
      console.error(`❌ Erreur regex pour ${fieldName}:`, error);
    }
  });
  
  console.log(`📊 Résultat: ${updatedCount}/${Object.keys(updates).length} champs mis à jour`);
  return content;
}

async function updateTomlConfig(repoName, updates, githubToken, repoOwner) {
  const configUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/config.toml`;
  
  try {
    console.log(`📝 Récupération config.toml pour ${repoName}...`);
    
    const response = await fetch(configUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      throw new Error(`Impossible de récupérer config.toml: ${response.status}`);
    }
    
    const fileData = await response.json();
    let content = base64ToString(fileData.content);
    
    let hasChanges = false;
    
    if (updates['site.name']) {
      const oldContent = content;
      content = content.replace(/title\s*=\s*"[^"]*"/, `title = "${updates['site.name']}"`);
      if (content !== oldContent) {
        hasChanges = true;
        console.log(`✓ Mis à jour title = ${updates['site.name']}`);
      }
    }
    
    if (updates['site.language']) {
      const oldContent = content;
      content = content.replace(/languageCode\s*=\s*"[^"]*"/, `languageCode = "${updates['site.language']}"`);
      if (content !== oldContent) {
        hasChanges = true;
        console.log(`✓ Mis à jour languageCode = ${updates['site.language']}`);
      }
    }
    
    // 🆕 AJOUT GESTION BASEURL
    if (updates['baseURL']) {
      const oldContent = content;
      content = content.replace(/baseURL\s*=\s*"[^"]*"/, `baseURL = "${updates['baseURL']}"`);
      if (content !== oldContent) {
        hasChanges = true;
        console.log(`✓ Mis à jour baseURL = ${updates['baseURL']}`);
      }
    }
    
    if (!hasChanges) {
      console.log('ℹ️ Aucun changement nécessaire pour config.toml');
      return { success: true };
    }
    
    const encodedContent = stringToBase64(content);
    
    const updateResponse = await fetch(configUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: JSON.stringify({
        message: '⚙️ Mise à jour config.toml via admin',
        content: encodedContent,
        sha: fileData.sha
      })
    });
    
    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      throw new Error(`Erreur sauvegarde config.toml: ${error.message}`);
    }
    
    console.log('✅ config.toml mis à jour avec succès');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Erreur updateTomlConfig:', error);
    return { success: false, error: error.message };
  }
}

// ===================================================================
// 🆕 GESTION DES FICHIERS MARKDOWN
// ===================================================================

async function updateMarkdownFiles(repoName, legalUpdates, githubToken, repoOwner) {
  console.log(`📝 Mise à jour des fichiers Markdown: ${Object.keys(legalUpdates).length} fichiers`);
  
  const fileMapping = {
    'legal_pages.mentions_legales.content': 'content/mentions-legales.md',
    'legal_pages.politique_confidentialite.content': 'content/politique-confidentialite.md',
    'legal_pages.conditions_utilisation.content': 'content/conditions-utilisation.md'
  };
  
  const results = [];
  
  for (const [fieldName, content] of Object.entries(legalUpdates)) {
    const filePath = fileMapping[fieldName];
    if (filePath) {
      console.log(`📄 Mise à jour: ${filePath}`);
      const result = await updateSingleMarkdownFile(repoName, filePath, content, githubToken, repoOwner);
      results.push({ file: filePath, success: result.success });
    }
  }
  
  return {
    success: true,
    files_updated: results.filter(r => r.success).map(r => r.file),
    files_failed: results.filter(r => !r.success).map(r => r.file)
  };
}

async function updateSingleMarkdownFile(repoName, filePath, content, githubToken, repoOwner) {
  const fileUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
  
  try {
    // 1. Récupérer le fichier existant
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      throw new Error(`Fichier ${filePath} non trouvé: ${response.status}`);
    }
    
    const fileData = await response.json();
    const currentContent = base64ToString(fileData.content);
    
    // 2. Extraire le front matter existant
    const frontMatterMatch = currentContent.match(/^---\n([\s\S]*?)\n---/);
    const frontMatter = frontMatterMatch ? frontMatterMatch[0] : '---\ntitle: "Page légale"\nlayout: "legal/default"\n---';
    
    // 3. Construire le nouveau contenu
    const newContent = `${frontMatter}\n\n${content}`;
    
    // 4. Sauvegarder
    const encodedContent = stringToBase64(newContent);
    
    const updateResponse = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: JSON.stringify({
        message: `📝 Mise à jour ${filePath} via admin`,
        content: encodedContent,
        sha: fileData.sha
      })
    });
    
    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      throw new Error(`Erreur sauvegarde ${filePath}: ${error.message}`);
    }
    
    console.log(`✅ ${filePath} mis à jour avec succès`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Erreur ${filePath}:`, error);
    return { success: false, error: error.message };
  }
}

// ===================================================================
// GESTION DES SITES (CLONE, LIST, DELETE)
// ===================================================================

async function handleCloneSite(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const data = await request.json();
    
    if (!data.site_name || !data.repo_name) {
      return jsonResponse({ error: 'site_name et repo_name requis' }, 400, corsHeaders);
    }

    if (!/^[a-z0-9-_]+$/.test(data.repo_name)) {
      return jsonResponse({ error: 'repo_name: lettres minuscules, chiffres et tirets uniquement' }, 400, corsHeaders);
    }

    const required = ['GITHUB_TOKEN', 'REPO_OWNER', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
    for (const variable of required) {
      if (!env[variable]) {
        return jsonResponse({ error: `Variable manquante: ${variable}` }, 500, corsHeaders);
      }
    }

    const result = await cloneSiteTemplate(data, env, request);
    
    return jsonResponse({
      success: true,
      message: `Site "${data.site_name}" créé avec succès !`,
      ...result
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Erreur clonage:', error);
    return jsonResponse({ 
      error: 'Erreur lors du clonage',
      details: error.message 
    }, 500, corsHeaders);
  }
}

// ===================================================================
// 🔐 FONCTIONS ADMIN SÉCURISÉ
// ===================================================================

function generateRandomAdminPath() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateAdminCredentials() {
  return {
    path: generateRandomAdminPath(),
    password: generateRandomPassword()
  };
}

async function cloneSiteTemplate(data, env, request) {
  const { GITHUB_TOKEN, REPO_OWNER, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = env;
  
  try {
    console.log(`🚀 Début du clonage pour: ${data.site_name}`);
    
    console.log('📄 Duplication du template...');
    // ✅ CORRIGÉ : Utilise la nouvelle détection de repo
    const sourceRepo = await getSourceRepo(request, env);
    const templateResponse = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${sourceRepo}/generate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          name: data.repo_name,
          description: `Site ${data.site_name} - Généré automatiquement`,
          private: true,
          include_all_branches: false
        })
      }
    );

    if (!templateResponse.ok) {
      const error = await templateResponse.json();
      throw new Error(`Template API failed: ${error.message}`);
    }

    const repoResult = await templateResponse.json();
    console.log('✅ Template dupliqué avec succès');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
        // 🔐 GÉNÉRATION ADMIN SÉCURISÉ
    console.log('🔐 Génération admin sécurisé...');
    const adminCredentials = generateAdminCredentials();
    console.log(`✅ Admin path: /${adminCredentials.path}/`);
    
    if (data.hero_line1 || data.hero_line2) {
      console.log('⚙️ Configuration personnalisée...');
      await configureSiteTemplate(data, GITHUB_TOKEN, REPO_OWNER);
    }
    
    console.log('🚀 Déploiement automatique via Workers...');
    const deploymentResult = await createCloudflareWorker(data, data.repo_name, REPO_OWNER, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_ZONE_ID || null, GITHUB_TOKEN, adminCredentials);
    
    console.log('💾 Enregistrement dans le registry...');
    
    // ✅ CORRIGÉ : Amélioration du stockage registry
    const finalUrl = deploymentResult.url;
    const domainOnly = finalUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    
    const siteData = {
      id: data.repo_name,
      name: data.site_name,
      repo: `${REPO_OWNER}/${data.repo_name}`,
      domain: domainOnly,  // Sans https:// (ex: "comfortfood.uk")
      domain_www: `www.${domainOnly}`, // ✅ AJOUT : Version www
      admin_url: `${finalUrl}${adminCredentials.path}/`,  // Admin sécurisé
      admin_path: adminCredentials.path,  // Chemin aléatoire
      admin_password: adminCredentials.password,  // Password unique  // Avec trailing slash
      created_at: new Date().toISOString(),
      status: 'active',
      github_url: repoResult.html_url,
      deployment_type: deploymentResult.type,
      deployment_url: finalUrl,  // URL complète avec https://
      deployment_url_www: finalUrl.replace('://', '://www.') // ✅ AJOUT : Version www complète
    };
    
    await saveSiteToRegistry(data.repo_name, siteData, env);
    
    console.log('✅ Clonage terminé avec succès (Template API)');
    
    return {
      site_id: data.repo_name,
      primary_url: deploymentResult.url,
      admin_url: `${deploymentResult.url}${adminCredentials.path}/`,
      admin_credentials: {
        path: adminCredentials.path,
        password: adminCredentials.password,
        username: 'admin'
      },
      github_url: repoResult.html_url,
      deployment_type: deploymentResult.type,
      deployment_note: deploymentResult.note || null
    };
    
  } catch (error) {
    console.error('❌ Erreur durant le clonage:', error);
    throw new Error(`Échec du clonage: ${error.message}`);
  }
}

async function configureSiteTemplate(data, token, owner) {
  const configUrl = `https://api.github.com/repos/${owner}/${data.repo_name}/contents/data/config.yaml`;
  
  try {
    const [contentResponse, metaResponse] = await Promise.all([
      fetch(configUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/vnd.github.v3.raw'
        }
      }),
      fetch(configUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': CONFIG.USER_AGENT
        }
      })
    ]);
    
    if (!contentResponse.ok) return;
    
    let content = await contentResponse.text();
    const fileMeta = await metaResponse.json();
    
    content = content.replace(/name:\s*"?Test"?/g, `name: "${data.site_name}"`);
    content = content.replace(/logo_text:\s*"?T"?/g, `logo_text: "${data.site_name.charAt(0).toUpperCase()}"`);
    
    if (data.hero_line1) {
      content = content.replace(/hero_title_line1:\s*.*/g, `hero_title_line1: "${data.hero_line1}"`);
    }
    
    if (data.hero_line2) {
      content = content.replace(/hero_title_line2:\s*.*/g, `hero_title_line2: "${data.hero_line2}"`);
    }
    
    const encodedContent = stringToBase64(content);
    
    await fetch(configUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: JSON.stringify({
        message: `⚙️ Configuration du site "${data.site_name}"`,
        content: encodedContent,
        sha: fileMeta.sha
      })
    });
    console.log('✅ Configuration appliquée');
    
    console.log('⚙️ Modification du config.toml...');
    // ✅ CORRIGÉ : Normalisation domaine unifiée
    const finalURL = data.domain && data.domain.trim() 
      ? normaliseDomain(data.domain)  // 🎯 Domaine personnalisé normalisé
      : `https://${data.repo_name}.workers.dev/`;  // Automatique
    
    console.log(`🔗 BaseURL configuré : ${finalURL}`);
    
    const tomlUpdates = {
      'site.name': data.site_name,
      'baseURL': finalURL  // 🎯 Injection automatique normalisée
    };
    
    // Ajouter la langue si fournie
    if (data.language) {
      tomlUpdates['site.language'] = data.language;
    }
    
    const tomlResult = await updateTomlConfig(data.repo_name, tomlUpdates, token, owner);
    
    if (tomlResult.success) {
      console.log('✅ config.toml mis à jour via updateTomlConfig');
    } else {
      console.error('❌ Erreur updateTomlConfig:', tomlResult.error);
    }
    
  } catch (error) {
    console.warn('⚠️ Erreur configuration (non critique):', error.message);
  }
}

// ===================================================================
// CRÉATION CLOUDFLARE WORKER (avec fixes domaines)
// ===================================================================

/* ------------------------------------------------------------------
   UTIL – crée A / www / AAAA « proxied » s'ils n'existent pas
   ------------------------------------------------------------------ */
async function ensureDnsRecords(fullDomainName, zoneId, apiToken) {
  console.log(`🔧 Création DNS pour: ${fullDomainName}`);
  
  const templates = [
    { type: 'A',    name: fullDomainName,          content: '192.0.2.1' },
    { type: 'A',    name: `www.${fullDomainName}`, content: '192.0.2.1' },
    { type: 'AAAA', name: fullDomainName,          content: '100::' }
  ];

  for (const rec of templates) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...rec, proxied: true })
      }
    );

    /* 81057 = « record already exists »  → on passe silencieusement */
    if (!res.ok) {
      const { errors = [] } = await res.json();
      if (!(errors[0]?.code === 81057)) {
        console.warn(`⚠️ DNS ${rec.name}: ${errors[0]?.message || res.status}`);
      }
    } else {
      console.log(`✓ DNS ${rec.type} ${rec.name}`);
    }
  }
}

async function createCloudflareWorker(data, repoName, repoOwner, apiToken, accountId, zoneId = null, githubToken, adminCredentials) {
  console.log('⚡ Déploiement automatique via GitHub Actions + Workers');
  
  try {
    console.log('🔨 Création du Worker...');
    
    const workerScript = generateWorkerScript(repoName, repoOwner, adminCredentials.path, adminCredentials.password);
    
    const createWorkerResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${repoName}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/javascript'
        },
        body: workerScript
      }
    );

    if (!createWorkerResponse.ok) {
      const error = await createWorkerResponse.json();
      console.error('Erreur Worker:', error);
      throw new Error(`Erreur création Worker: ${error.errors?.[0]?.message || 'Erreur inconnue'}`);
    }

    console.log('✅ Worker créé');

    // 🌐 Configuration route pour domaine personnalisé
    const customDomain = data.domain && data.domain.trim() && data.domain !== "";
    if (customDomain) {
      console.log(`🌐 Configuration route pour domaine personnalisé : ${data.domain}`);
    
      // ✅ CORRIGÉ : Normalisation uniforme
      const domainName = normaliseForComparison(data.domain);
    
      /* ------------------------------------------------------------------
         1) Trouver (ou confirmer) le zoneId
      ------------------------------------------------------------------ */
      if (!zoneId) {
        // a) Tentative directe : /zones?name=example.com
        const direct = await fetch(
          `https://api.cloudflare.com/client/v4/zones?name=${domainName}`,
          { headers: { 'Authorization': `Bearer ${apiToken}` } }
        ).then(r => r.json());
    
        if (direct.success && direct.result.length) {
          zoneId = direct.result[0].id;
          console.log(`🔑 Zone trouvée par nom exact : ${zoneId}`);
        }
    
        // b) Fallback : on parcourt toutes les zones et on prend celle
        //    dont le .name est un suffixe de notre domaine (gère sous-domaines).
        if (!zoneId) {
          const list = await fetch(
            'https://api.cloudflare.com/client/v4/zones?per_page=50',
            { headers: { 'Authorization': `Bearer ${apiToken}` } }
          ).then(r => r.json());
    
          const match = list.result.find(z => domainName.endsWith(z.name));
          if (match) {
            zoneId = match.id;
            console.log(`🔑 Zone trouvée par suffixe : ${match.name} → ${zoneId}`);
          }
        }
    
        if (!zoneId) {
          console.warn(`⚠️ Zone introuvable pour ${domainName} — aucune route créée`);
        }
      }
    
      /* ------------------------------------------------------------------
         2) Créer la route si on a le zoneId
      ------------------------------------------------------------------ */
      if (zoneId) {
        try {
          // 📍 CRÉER LES 2 ROUTES (apex + www)
          const patterns = [
            domainName,           // comfortfood.uk/*
            `www.${domainName}`   // www.comfortfood.uk/*
          ];
          
          for (const host of patterns) {
            try {
              const routeRes = await fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    pattern: `${host}/*`,
                    script: repoName
                  })
                }
              );

              if (!routeRes.ok) {
                const err = await routeRes.json();
                // Code 10020 = route existe déjà, on ignore
                if (err.errors?.[0]?.code !== 10020) {
                  throw new Error(err.errors?.[0]?.message || `Status ${routeRes.status}`);
                }
              }
              
              console.log(`✅ Route configurée : ${host}/* → Worker ${repoName}`);
              
            } catch (e) {
              console.warn(`⚠️ Route ${host} : ${e.message}`);
            }
          }
          
          // 📍 DNS AUTOMATIQUES
          try {
            console.log(`🔧 Vérification / ajout DNS pour ${domainName}…`);
            await ensureDnsRecords(domainName, zoneId, apiToken);
            console.log('✅ DNS prêts');
          } catch (e) {
            console.warn(`⚠️ DNS auto : ${e.message}`);
          }
        } catch (error) {
          console.warn(`⚠️ Erreur configuration route : ${error.message}`);
        }
      }
    }
    
    const domainResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${repoName}/subdomain`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enabled: true
        })
      }
    );
    if (domainResponse.ok) {
      console.log('✅ Domaine .workers.dev activé');
    } else {
      console.warn('⚠️ Activation domaine échouée (peut être déjà actif)');
    }

    console.log('📄 Activation GitHub Pages...');
    await enableGitHubPages(repoName, repoOwner, githubToken);

    console.log('🤖 Ajout GitHub Actions...');
    await addGitHubAction(repoName, repoOwner, githubToken, accountId, apiToken);

    console.log('🚀 Déclenchement du premier build...');
    await triggerGitHubAction(repoName, repoOwner, githubToken);

    // ✅ CORRIGÉ : Retour URL uniforme
    if (customDomain) {
        const finalUrl = normaliseDomain(data.domain);
        console.log(`🌐 Utilisation domaine personnalisé: ${finalUrl}`);
        return {
            id: repoName,
            name: repoName,
            url: finalUrl,
            type: 'custom-domain'
        };
    } else {
        const autoUrl = `https://${repoName}.kasri-elmehdi.workers.dev/`;
        console.log(`🌐 Utilisation Workers automatique: ${autoUrl}`);
        return {
            id: repoName,
            name: repoName,
            url: autoUrl,
            type: 'worker-auto'
        };
    }

  } catch (error) {
    console.error('❌ Erreur déploiement automatique:', error);
    throw error;
  }
}

function generateWorkerScript(repoName, repoOwner, adminPath, adminPassword) {
  const tpl = `// Worker auto-généré pour ${repoName} - ADMIN SÉCURISÉ
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 🔒 BLOQUER /admin/ ORIGINAL
  if (url.pathname.startsWith('/admin/')) {
    return new Response('Not Found', { status: 404 });
  }
  
  // ✅ ADMIN SÉCURISÉ - CHEMIN ALÉATOIRE
  if (url.pathname.startsWith('/\${ADMIN_PATH}/')) {
    
    // 🔐 BASIC AUTH REQUIS
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Basic ')) {
      return new Response('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Admin"' }
      });
    }
    
    // Vérifier credentials
    const encoded = auth.substring(6);
    const decoded = atob(encoded);
    const [username, password] = decoded.split(':');
    
    if (username !== 'admin' || password !== '\${ADMIN_PASSWORD}') {
      return new Response('Invalid credentials', { status: 401 });
    }
    
    // 🔄 MAPPING: /randomPath/page.html → /admin/page.html
    const adminMappedPath = url.pathname.replace('/\${ADMIN_PATH}', '/admin');
    const githubUrl = "https://\${OWNER}.github.io/\${REPO}" + adminMappedPath;
    
    try {
      const response = await fetch(githubUrl, {
        headers: { 'User-Agent': 'Cloudflare-Worker' }
      });
      
      if (response.ok) {
        return new Response(response.body, {
          status: response.status,
          headers: response.headers
        });
      }
    } catch (error) {
      console.error('Admin fetch error:', error);
    }
    
    return new Response('Admin temporarily unavailable', { status: 503 });
  }
  
  // 📄 CONTENU NORMAL - logique existante
  const githubUrl = "https://\${OWNER}.github.io/\${REPO}" + url.pathname;
  
  try {
    const response = await fetch(githubUrl, {
      headers: {
        'User-Agent': 'Cloudflare-Worker'
      }
    });
    
    if (response.ok) {
      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
      newResponse.headers.set('X-Powered-By', 'Cloudflare Workers + GitHub Actions');
      newResponse.headers.set('Cache-Control', 'public, max-age=300');
      
      return newResponse;
    }
    
    const indexResponse = await fetch("https://\${OWNER}.github.io/\${REPO}/");
    return new Response(indexResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'X-Powered-By': 'Cloudflare Workers + GitHub Actions'
      }
    });
    
  } catch (error) {
    return new Response('Site en cours de déploiement...', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain',
        'Retry-After': '60'
      }
    });
  }
}`;

  return tpl
    .replace(/\$\{OWNER\}/g, repoOwner)
    .replace(/\$\{REPO\}/g, repoName)
    .replace(/\$\{ADMIN_PATH\}/g, adminPath)
    .replace(/\$\{ADMIN_PASSWORD\}/g, adminPassword);
}

async function enableGitHubPages(repoName, repoOwner, githubToken) {
  try {
    console.log('🔧 Configuration GitHub Pages...');
    
    const pagesResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          source: {
            branch: 'main',
            path: '/'
          },
          build_type: 'workflow'
        })
      }
    );

    if (!pagesResponse.ok) {
      const error = await pagesResponse.json();
      
      if (error.message?.includes('already exists')) {
        console.log('🔄 Mise à jour GitHub Pages vers workflow...');
        
        const updateResponse = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoName}/pages`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `token ${githubToken}`,
              'Content-Type': 'application/json',
              'User-Agent': CONFIG.USER_AGENT,
              'Accept': 'application/vnd.github+json'
            },
            body: JSON.stringify({
              source: {
                branch: 'main',
                path: '/'
              },
              build_type: 'workflow'
            })
          }
        );
        
        if (updateResponse.ok) {
          console.log('✅ GitHub Pages configuré pour workflow');
        } else {
          console.warn('⚠️ Mise à jour Pages échouée (non critique)');
        }
      } else if (pagesResponse.status === 422) {
        console.log('⚠️ GitHub Pages: workflow pas encore prêt (normal)');
      } else {
        console.warn(`⚠️ GitHub Pages: ${error.message} (non critique)`);
      }
    } else {
      console.log('✅ GitHub Pages activé avec workflow');
    }
    
  } catch (error) {
    console.warn('⚠️ Erreur GitHub Pages (non critique):', error.message);
  }
}

async function addGitHubAction(repoName, repoOwner, githubToken, accountId, apiToken) {
 const actionYml = `name: Deploy to GitHub Pages + Cloudflare (Optimized)

on:
 push:
   branches: [ main ]
 workflow_dispatch:

permissions:
 contents: read
 pages: write
 id-token: write

concurrency:
 group: "pages"
 cancel-in-progress: false

jobs:
 build-and-deploy:
   runs-on: ubuntu-latest
   
   steps:
     - name: Checkout
       uses: actions/checkout@v4
       
     - name: Setup Node.js
       uses: actions/setup-node@v4
       with:
         node-version: '20'
         cache: 'npm'
         
     - name: Cache Hugo resources
       uses: actions/cache@v3
       with:
         path: |
           resources/_gen
           public
           .hugo_build.lock
         key: hugo-cache-\${{ hashFiles('assets/**', 'content/**', 'data/**', 'layouts/**') }}
         restore-keys: |
           hugo-cache-
         
     - name: Install dependencies
       run: npm ci
       
     - name: Build assets
       run: |
         npm run build:css
         npm run build:js
       
     - name: Setup Hugo
       uses: peaceiris/actions-hugo@v3
       with:
         hugo-version: 'latest'
         extended: true
         
     - name: Build site (Optimized)
       run: |
         echo "🚀 Starting optimized build..."
         
         if [ -d "resources/_gen" ] && [ -d "public" ]; then
           echo "📦 Cache found - doing incremental build"
           hugo --minify --quiet
         else
           echo "🏗️ No cache - doing full build"
           hugo --gc --minify
         fi
         
         echo "✅ Build complete!"
         
     - name: Setup Pages
       uses: actions/configure-pages@v4
       
     - name: Upload artifact
       uses: actions/upload-pages-artifact@v3
       with:
         path: './public'
         
     - name: Deploy to GitHub Pages
       id: deployment
       uses: actions/deploy-pages@v4
`;

 try {
   console.log('🗑️ Suppression ancien workflow...');
   const deleteOldResponse = await fetch(
     `https://api.github.com/repos/${repoOwner}/${repoName}/contents/.github/workflows/build-and-deploy.yml`,
     {
       headers: {
         'Authorization': `token ${githubToken}`,
         'User-Agent': CONFIG.USER_AGENT
       }
     }
   );
   
   if (deleteOldResponse.ok) {
     const oldFile = await deleteOldResponse.json();
     await fetch(
       `https://api.github.com/repos/${repoOwner}/${repoName}/contents/.github/workflows/build-and-deploy.yml`,
       {
         method: 'DELETE',
         headers: {
           'Authorization': `token ${githubToken}`,
           'Content-Type': 'application/json',
           'User-Agent': CONFIG.USER_AGENT
         },
         body: JSON.stringify({
           message: '🗑️ Suppression ancien workflow',
           sha: oldFile.sha
         })
       }
     );
     console.log('✅ Ancien workflow supprimé');
   }
 } catch (error) {
   console.warn('⚠️ Ancien workflow non trouvé (normal)');
 }

 const workflowContent = stringToBase64(actionYml);
 
 const createWorkflowResponse = await fetch(
   `https://api.github.com/repos/${repoOwner}/${repoName}/contents/.github/workflows/deploy.yml`,
   {
     method: 'PUT',
     headers: {
       'Authorization': `token ${githubToken}`,
       'Content-Type': 'application/json',
       'User-Agent': CONFIG.USER_AGENT
     },
     body: JSON.stringify({
       message: '🤖 Workflow avec protection YAML automatique',
       content: workflowContent
     })
   }
 );

 if (!createWorkflowResponse.ok) {
   const error = await createWorkflowResponse.json();
   throw new Error(`Erreur création workflow: ${error.message}`);
 }

 console.log('✅ GitHub Action ajoutée avec protection YAML');
}

async function triggerGitHubAction(repoName, repoOwner, githubToken) {
  try {
    const triggerResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/deploy.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'User-Agent': CONFIG.USER_AGENT
        },
        body: JSON.stringify({
          ref: 'main'
        })
      }
    );

    console.log('✅ Premier build déclenché');
  } catch (error) {
    console.warn('⚠️ Trigger manuel échoué (le push va déclencher automatiquement)');
  }
}

async function handleListSites(request, env, corsHeaders) {
 if (request.method !== 'GET') {
   return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
 }

 try {
   const sites = await getSitesFromRegistry(env);
   
   // 🔒 SUPPRIMER les champs sensibles de la réponse
   const safeSites = {};
   Object.entries(sites).forEach(([siteId, siteData]) => {
       safeSites[siteId] = {
           id: siteData.id,
           name: siteData.name,
           domain: siteData.domain,
           status: siteData.status,
           created_at: siteData.created_at,
           deployment_url: siteData.deployment_url
           // 🚫 SUPPRIMÉ : admin_url, admin_path, admin_password, repo, github_url
       };
   });

   return jsonResponse({ 
     success: true, 
     sites: safeSites,
     count: Object.keys(safeSites).length 
   }, 200, corsHeaders);
 } catch (error) {
   console.error('Erreur récupération sites:', error);
   return jsonResponse({ 
     error: 'Erreur récupération des sites' 
   }, 500, corsHeaders);
 }
}

async function saveSiteToRegistry(siteId, siteData, env) {
  try {
    const currentSites = await getSitesFromRegistry(env);
    currentSites[siteId] = siteData;
    
    await env.SITES_REGISTRY.put('sites', JSON.stringify(currentSites));
    console.log(`💾 Site ${siteId} enregistré dans le registry`);
  } catch (error) {
    console.error('⚠️ Erreur sauvegarde registry:', error.message);
    throw error;
  }
}

async function getSitesFromRegistry(env) {
  try {
    const sitesData = await env.SITES_REGISTRY.get('sites');
    return sitesData ? JSON.parse(sitesData) : {};
  } catch (error) {
    console.error('⚠️ Erreur lecture registry:', error.message);
    return {};
  }
}

async function handleDeleteSite(request, env, corsHeaders) {
  if (request.method !== 'DELETE') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const { GITHUB_TOKEN, REPO_OWNER, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = env;
    
    if (!GITHUB_TOKEN || !REPO_OWNER || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
      return jsonResponse({ error: 'Variables d\'environnement manquantes' }, 500, corsHeaders);
    }

    const data = await request.json();
    
    if (!data.site_id) {
      return jsonResponse({ error: 'site_id requis' }, 400, corsHeaders);
    }

    console.log(`🗑️ Début de la suppression pour: ${data.site_id}`);

    console.log('🗑️ Suppression du Worker...');
    await deleteCloudflareWorker(data.site_id, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID);

    console.log('🗑️ Suppression du repository...');
    await deleteGitHubRepository(data.site_id, REPO_OWNER, GITHUB_TOKEN);

    console.log('🗑️ Suppression du registry...');
    await deleteSiteFromRegistry(data.site_id, env);

    console.log('✅ Suppression terminée avec succès');

    return jsonResponse({
      success: true,
      message: `Site ${data.site_id} supprimé avec succès`,
      deleted_items: ['worker', 'repository', 'registry']
    }, 200, corsHeaders);

  } catch (error) {
    console.error('❌ Erreur durant la suppression:', error);
    return jsonResponse({
      error: 'Échec de la suppression: ' + error.message
    }, 500, corsHeaders);
  }
}

async function deleteCloudflareWorker(workerName, apiToken, accountId) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.json();
    throw new Error(`Erreur suppression Worker: ${error.errors?.[0]?.message || 'Erreur inconnue'}`);
  }

  console.log('✅ Worker supprimé');
}

async function deleteGitHubRepository(repoName, repoOwner, githubToken) {
  const response = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.json();
    throw new Error(`Erreur suppression repository: ${error.message || 'Erreur inconnue'}`);
  }

  console.log('✅ Repository supprimé');
}

async function deleteSiteFromRegistry(siteId, env) {
  try {
    const currentSites = await getSitesFromRegistry(env);
    delete currentSites[siteId];
    await env.SITES_REGISTRY.put('sites', JSON.stringify(currentSites));
    console.log('✅ Site supprimé du registry');
  } catch (error) {
    console.warn('⚠️ Erreur suppression registry (non critique):', error.message);
  }
}

async function handleListDomains(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const { CLOUDFLARE_API_TOKEN } = env;
    
    if (!CLOUDFLARE_API_TOKEN) {
      return jsonResponse({ error: 'Token Cloudflare manquant' }, 500, corsHeaders);
    }
    
    // 1. Récupérer tous les domaines Cloudflare
    const response = await fetch(
      'https://api.cloudflare.com/client/v4/zones',
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Erreur Cloudflare API: ${response.status}`);
    }
    
    const data = await response.json();
    const allDomains = data.result.map(zone => zone.name);
    
    // 2. ✅ NOUVEAU : Récupérer les domaines déjà utilisés
    const sites = await getSitesFromRegistry(env);
    const usedDomains = Object.values(sites)
      .map(site => site.domain)
      .filter(domain => domain) // Enlever les null/undefined
      .map(domain => domain.replace(/^www\./, '')); // Normaliser (enlever www)
    
    // 3. ✅ FILTRER : Garder seulement les domaines disponibles
    const availableDomains = allDomains.filter(domain => {
      const normalizedDomain = domain.replace(/^www\./, '');
      return !usedDomains.includes(normalizedDomain);
    });
    
    console.log(`📊 Domaines: ${allDomains.length} total, ${usedDomains.length} utilisés, ${availableDomains.length} disponibles`);
    
    return jsonResponse({ 
      success: true, 
      domains: availableDomains,
      available_count: availableDomains.length,
      total_count: allDomains.length,
      used_domains: usedDomains // ✅ Pour debug
    }, 200, corsHeaders);
    
  } catch (error) {
    console.error('❌ Erreur handleListDomains:', error);
    return jsonResponse({ 
      error: 'Erreur récupération domaines: ' + error.message 
    }, 500, corsHeaders);
  }
}
// ===================================================================
// 🆕 GESTION DES ARTICLES/RECETTES
// ===================================================================

async function handleListArticles(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const origin = request.headers.get('Origin');
    
    if (!origin) {
      return jsonResponse({ error: 'Origin manquant' }, 400, corsHeaders);
    }
    
    const { GITHUB_TOKEN, REPO_OWNER } = env;
    if (!GITHUB_TOKEN || !REPO_OWNER) {
      return jsonResponse({
        error: 'Variables d\'environnement GitHub manquantes'
      }, 500, corsHeaders);
    }
    
    const targetRepo = await getSourceRepo(request, env);
    console.log(`📄 Liste articles pour: ${targetRepo}`);
    
    const articles = await getArticlesFromGitHub(targetRepo, GITHUB_TOKEN, REPO_OWNER);
    
    return jsonResponse({
      success: true,
      articles: articles.articles || [],
      count: articles.count || 0,
      repo: targetRepo
    }, 200, corsHeaders);
    
  } catch (error) {
    console.error('❌ Erreur handleListArticles:', error);
    return jsonResponse({ 
      error: 'Erreur serveur: ' + error.message 
    }, 500, corsHeaders);
  }
}

async function handleGetArticle(request, env, corsHeaders) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const url = new URL(request.url);
    const articleSlug = url.searchParams.get('slug');
    
    if (!articleSlug) {
      return jsonResponse({ error: 'Paramètre slug requis' }, 400, corsHeaders);
    }
    
    const origin = request.headers.get('Origin');
    if (!origin) {
      return jsonResponse({ error: 'Origin manquant' }, 400, corsHeaders);
    }
    
    const { GITHUB_TOKEN, REPO_OWNER } = env;
    if (!GITHUB_TOKEN || !REPO_OWNER) {
      return jsonResponse({
        error: 'Variables d\'environnement GitHub manquantes'
      }, 500, corsHeaders);
    }
    
    const targetRepo = await getSourceRepo(request, env);
    console.log(`📄 Lecture article ${articleSlug} pour: ${targetRepo}`);
    
    const article = await getSingleArticleFromGitHub(targetRepo, articleSlug, GITHUB_TOKEN, REPO_OWNER);
    
    if (article.success) {
      return jsonResponse({
        success: true,
        article: article.article,
        repo: targetRepo
      }, 200, corsHeaders);
    } else {
      return jsonResponse({
        success: false,
        error: article.error
      }, 404, corsHeaders);
    }
    
  } catch (error) {
    console.error('❌ Erreur handleGetArticle:', error);
    return jsonResponse({ 
      error: 'Erreur serveur: ' + error.message 
    }, 500, corsHeaders);
  }
}

async function handleSaveArticle(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405, corsHeaders);
  }

  try {
    const origin = request.headers.get('Origin');
    const data = await request.json();
    
    if (!origin) {
      return jsonResponse({ error: 'Origin manquant' }, 400, corsHeaders);
    }
    
    // Validation des données requises
    if (!data.title || !data.content) {
      return jsonResponse({ error: 'title et content requis' }, 400, corsHeaders);
    }
    
    const { GITHUB_TOKEN, REPO_OWNER } = env;
    if (!GITHUB_TOKEN || !REPO_OWNER) {
      return jsonResponse({
        error: 'Variables d\'environnement GitHub manquantes'
      }, 500, corsHeaders);
    }
    
    const targetRepo = await getSourceRepo(request, env);
    console.log(`💾 Sauvegarde article pour: ${targetRepo}`);
    
    const result = await saveArticleToGitHub(targetRepo, data, GITHUB_TOKEN, REPO_OWNER);
    
    if (result.success) {
      return jsonResponse({
        success: true,
        message: 'Article sauvegardé avec succès',
        article: result.article,
        file_path: result.file_path,
        repo: targetRepo
      }, 200, corsHeaders);
    } else {
      return jsonResponse({
        success: false,
        error: result.error
      }, 500, corsHeaders);
    }
    
  } catch (error) {
    console.error('❌ Erreur handleSaveArticle:', error);
    return jsonResponse({ 
      error: 'Erreur serveur: ' + error.message 
    }, 500, corsHeaders);
  }
}

// ===================================================================
// FONCTIONS UTILITAIRES POUR LES ARTICLES
// ===================================================================

async function getArticlesFromGitHub(repoName, githubToken, repoOwner) {
  const articlesUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/content/recipes`;
  
  try {
    console.log(`📂 Récupération articles pour ${repoName}...`);
    
    const response = await fetch(articlesUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return { articles: [], count: 0 };
      }
      throw new Error(`Erreur GitHub API: ${response.status}`);
    }
    
    const files = await response.json();
    const articles = [];
    
    for (const file of files) {
      if (file.name.endsWith('.md') && file.type === 'file') {
        try {
          // Récupérer le contenu de chaque fichier pour extraire les métadonnées
          const fileResponse = await fetch(file.download_url);
          const content = await fileResponse.text();
          
          // Extraire le front matter
          const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          let metadata = {};
          
          if (frontMatterMatch) {
            const frontMatter = frontMatterMatch[1];
            // Parser basique du front matter
            frontMatter.split('\n').forEach(line => {
              const [key, ...valueParts] = line.split(':');
              if (key && valueParts.length) {
                const value = valueParts.join(':').trim().replace(/['"]/g, '');
                metadata[key.trim()] = value;
              }
            });
          }
          
          articles.push({
            slug: file.name.replace('.md', ''),
            filename: file.name,
            title: metadata.title || file.name.replace('.md', ''),
            description: metadata.description || '',
            date: metadata.date || '',
            author: metadata.author || '',
            image: metadata.image || '',
            categories: metadata.categories ? metadata.categories.split(',').map(c => c.trim()) : [],
            tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : [],
            draft: metadata.draft === 'true',
            file_size: file.size,
            last_modified: file.sha
          });
          
        } catch (error) {
          console.warn(`⚠️ Erreur lecture ${file.name}:`, error.message);
        }
      }
    }
    
    // Trier par date (plus récent en premier)
    articles.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`✅ ${articles.length} articles trouvés`);
    
    return {
      articles,
      count: articles.length
    };
    
  } catch (error) {
    console.error('❌ Erreur getArticlesFromGitHub:', error);
    return { articles: [], count: 0, error: error.message };
  }
}

async function getSingleArticleFromGitHub(repoName, articleSlug, githubToken, repoOwner) {
  const fileName = articleSlug.endsWith('.md') ? articleSlug : `${articleSlug}.md`;
  const fileUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/content/recipes/${fileName}`;
  
  try {
    console.log(`📄 Récupération article ${fileName} pour ${repoName}...`);
    
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });
    
    if (!response.ok) {
      return {
        success: false,
        error: `Article "${articleSlug}" non trouvé`
      };
    }
    
    const content = await response.text();
    
    // ✅ NOUVEAU PARSER SIMPLE ET EFFICACE
    const result = parseRecipeMarkdown(content);
    
    console.log(`✅ Article ${articleSlug} parsé avec succès`);
    console.log(`📊 Champs extraits: ${Object.keys(result).length}`);
    
    return {
      success: true,
      article: {
        slug: articleSlug,
        filename: fileName,
        ...result
      }
    };
    
  } catch (error) {
    console.error('❌ Erreur getSingleArticleFromGitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===================================================================
// 🆕 NOUVEAU PARSER SPÉCIALISÉ RECETTES
// ===================================================================

function parseRecipeMarkdown(content) {
  console.log('🔍 Parsing markdown recipe...');
  
  // Séparer front matter et contenu
  const parts = content.match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)$/);
  
  if (!parts) {
    console.warn('⚠️ Pas de front matter trouvé');
    return {
      title: '',
      content: content,
      ingredients: [],
      instructions: [],
      tags: [],
      categories: []
    };
  }
  
  const frontMatterText = parts[1];
  const articleContent = parts[2] || '';
  
  console.log('📝 Parsing front matter...');
  const parsed = parseRecipeFrontMatter(frontMatterText);
  
  // Ajouter le contenu
  parsed.content = articleContent.trim();
  
  console.log(`✅ Parsing terminé: ${Object.keys(parsed).length} champs`);
  return parsed;
}

function parseRecipeFrontMatter(yamlText) {
  const result = {};
  const lines = yamlText.split('\n');
  
  let currentKey = '';
  let currentArray = [];
  let isInArray = false;
  let isInMultiLine = false;
  let multiLineContent = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Ignorer lignes vides
    if (!trimmedLine) continue;
    
    // Détecter nouvelle propriété
    if (line.match(/^[a-zA-Z][a-zA-Z0-9_]*:\s*/)) {
      // Sauvegarder array précédent
      if (isInArray && currentKey) {
        result[currentKey] = currentArray;
        isInArray = false;
        currentArray = [];
      }
      
      // Sauvegarder multi-line précédent
      if (isInMultiLine && currentKey) {
        result[currentKey] = multiLineContent.trim();
        isInMultiLine = false;
        multiLineContent = '';
      }
      
      const [key, ...valueParts] = line.split(':');
      currentKey = key.trim();
      const value = valueParts.join(':').trim();
      
      if (!value || value === '') {
        // Propriété vide = array ou multi-line qui suit
        continue;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Array sur une ligne: tags: ["tag1", "tag2"]
        const arrayContent = value.slice(1, -1);
        if (arrayContent.trim()) {
          result[currentKey] = arrayContent
            .split(',')
            .map(item => item.trim().replace(/^["']|["']$/g, ''))
            .filter(item => item);
        } else {
          result[currentKey] = [];
        }
      } else {
        // Valeur simple
        result[currentKey] = value.replace(/^["']|["']$/g, '');
      }
      
    } else if (line.match(/^\s*-\s+/)) {
      // Élément d'array: - item
      isInArray = true;
      const arrayItem = line.replace(/^\s*-\s+/, '').trim();
      if (arrayItem) {
        currentArray.push(arrayItem);
      }
      
    } else if (line.match(/^\s*[a-zA-Z][a-zA-Z0-9_]*:\s*/)) {
      // Propriété indentée (objets)
      const [objKey, ...objValueParts] = line.trim().split(':');
      const objValue = objValueParts.join(':').trim().replace(/^["']|["']$/g, '');
      
      if (objKey && objValue) {
        // Pour les FAQ et objets imbriqués
        if (currentKey === 'nutrition') {
          if (!result[currentKey]) result[currentKey] = {};
          result[currentKey][objKey.trim()] = objValue;
        } else {
          result[`${currentKey}_${objKey.trim()}`] = objValue;
        }
      }
      
    } else if (isInArray && line.match(/^\s+/) && !line.includes(':')) {
      // Continuation d'array multi-ligne (pour instructions longues)
      const continuation = line.trim();
      if (continuation && currentArray.length > 0) {
        currentArray[currentArray.length - 1] += ' ' + continuation;
      }
      
    } else if (currentKey && line.match(/^\s+/)) {
      // Multi-line content (pour introduction, notes, etc.)
      isInMultiLine = true;
      multiLineContent += line.substring(2) + '\n'; // Garder indentation relative
    }
  }
  
  // Sauvegarder le dernier élément
  if (isInArray && currentKey) {
    result[currentKey] = currentArray;
  }
  if (isInMultiLine && currentKey) {
    result[currentKey] = multiLineContent.trim();
  }
  
  // ✅ NORMALISATION DES CHAMPS IMPORTANTS
  normalizeRecipeFields(result);
  
  return result;
}

function normalizeRecipeFields(data) {
  // Assurer que les arrays sont bien des arrays
  const arrayFields = ['ingredients', 'instructions', 'tags', 'categories', 'keywords', 'tips', 'faq'];
  
  arrayFields.forEach(field => {
    if (!data[field]) {
      data[field] = [];
    } else if (typeof data[field] === 'string') {
      // Convertir string en array si nécessaire
      if (data[field].includes(',')) {
        data[field] = data[field].split(',').map(item => item.trim()).filter(item => item);
      } else {
        data[field] = [data[field]];
      }
    }
  });
  
  // Assurer que les champs de base existent
  const basicFields = ['title', 'description', 'author', 'image', 'prepTime', 'cookTime', 'recipeYield'];
  basicFields.forEach(field => {
    if (!data[field]) {
      data[field] = '';
    }
  });
  
  // Normaliser la date
  if (!data.date) {
    data.date = new Date().toISOString().split('T')[0];
  }
  
  // Normaliser draft
  data.draft = data.draft === 'true' || data.draft === true;
  
  console.log('✅ Champs normalisés');
}

async function saveArticleToGitHub(repoName, articleData, githubToken, repoOwner) {
  // Générer le slug si pas fourni
  const slug = articleData.slug || articleData.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const fileName = `${slug}.md`;
  const filePath = `content/recipes/${fileName}`;
  const fileUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
  
  try {
    console.log(`💾 Sauvegarde article ${fileName} pour ${repoName}...`);
    
    // ✅ NOUVEAU : MERGE INTELLIGENT
    let finalData = { ...articleData };
    let sha = null;
    
    // Vérifier si le fichier existe déjà
    const existingResponse = await fetch(fileUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (existingResponse.ok) {
      const existingFile = await existingResponse.json();
      sha = existingFile.sha;
      
      console.log(`🔄 Fichier existant détecté - Merge intelligent...`);
      
      // Récupérer l'article existant
      const existingArticle = await getSingleArticleFromGitHub(repoName, slug, githubToken, repoOwner);
      
      if (existingArticle.success) {
        // ✅ MERGE : Garde l'existant, remplace seulement les champs modifiés
        finalData = { ...existingArticle.article, ...articleData };
        console.log(`✅ Merge effectué - ${Object.keys(articleData).length} champs mis à jour`);
      } else {
        console.log(`⚠️ Impossible de lire l'article existant - Création complète`);
      }
    } else {
      console.log(`🆕 Création d'un nouveau fichier`);
    }
    
    // ✅ CONSTRUIRE LE FRONT MATTER AVEC TOUTES LES DONNÉES MERGÉES
    const frontMatter = buildCompleteFrontMatter(finalData);
    
    const fullContent = `${frontMatter}\n\n${finalData.content || ''}`;
    const encodedContent = stringToBase64(fullContent);
    
    const saveResponse = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: JSON.stringify({
        message: sha ? `📝 Mise à jour article: ${finalData.title}` : `🆕 Nouvel article: ${finalData.title}`,
        content: encodedContent,
        ...(sha && { sha })
      })
    });
    
    if (!saveResponse.ok) {
      const error = await saveResponse.json();
      throw new Error(`Erreur sauvegarde: ${error.message}`);
    }
    
    console.log(`✅ Article ${fileName} sauvegardé avec succès`);
    
    return {
      success: true,
      article: {
        slug,
        filename: fileName,
        ...finalData
      },
      file_path: filePath
    };
    
  } catch (error) {
    console.error('❌ Erreur saveArticleToGitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ✅ NOUVELLE FONCTION : Construire front matter complet
function buildCompleteFrontMatter(data) {
  return `---
title: "${data.title || ''}"
slug: "${data.slug || ''}"
description: ${data.description ? `"${data.description}"` : ''}
metaDescription: ${data.metaDescription ? `"${data.metaDescription}"` : ''}
ogDescription: ${data.ogDescription ? `"${data.ogDescription}"` : ''}
focusKeyphrase: ${data.focusKeyphrase ? `"${data.focusKeyphrase}"` : ''}
date: ${data.date || new Date().toISOString().split('T')[0]}
draft: ${data.draft || false}
image: ${data.image || ''}
author: ${data.author ? `"${data.author}"` : ''}
prepTime: ${data.prepTime || ''}
cookTime: ${data.cookTime || ''}
totalTime: ${data.totalTime || ''}
recipeYield: ${data.recipeYield || ''}
categories: [${(data.categories || []).map(c => `"${c}"`).join(', ')}]
tags:${formatYamlArray(data.tags)}
cuisine: ${data.cuisine ? `"${data.cuisine}"` : ''}
keywords:${formatYamlArray(data.keywords)}
secondaryKeywords:${formatYamlArray(data.secondaryKeywords)}
breadcrumb: [${(data.breadcrumb || []).map(b => `"${b}"`).join(', ')}]
nutrition:${formatYamlObject(data.nutrition)}
ingredients:${formatYamlArray(data.ingredients)}
instructions:${formatYamlArray(data.instructions)}
introduction: ${data.introduction ? `"${data.introduction}"` : ''}
ingredientsNote: ${data.ingredientsNote ? `"${data.ingredientsNote}"` : ''}
instructionsNote: ${data.instructionsNote ? `"${data.instructionsNote}"` : ''}
tips:${formatYamlArray(data.tips)}
faq:${formatYamlArray(data.faq)}
---`;
}

// ✅ HELPER : Formater array YAML
function formatYamlArray(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return '';
  }
  
  return '\n' + arr.map(item => `- ${item}`).join('\n');
}

// ✅ HELPER : Formater objet YAML
function formatYamlObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return '';
  }
  
  const lines = Object.entries(obj).map(([key, value]) => `  ${key}: "${value}"`);
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}


// ===================================================================
// UTILITAIRES FINAUX
// ===================================================================

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 
      'Content-Type': 'application/json', 
      ...headers 
    }
  });
}

// ===================================================================
// TRACKING DES RECETTES POSTÉES
// ===================================================================







async function getSingleRecipeFromFile(file, repoName, env) {
  const { GITHUB_TOKEN, REPO_OWNER } = env;
  
  try {
    console.log(`📄 Lecture de ${file.name}...`);
    
    const fileResponse = await fetch(file.download_url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!fileResponse.ok) {
      throw new Error(`Erreur lecture fichier: ${fileResponse.status}`);
    }
    
    const content = await fileResponse.text();
    
    // Parser du front matter
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let metadata = {};
    
    if (frontMatterMatch) {
      const frontMatter = frontMatterMatch[1];
      frontMatter.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) {
          const value = valueParts.join(':').trim().replace(/['"]/g, '');
          metadata[key.trim()] = value;
        }
      });
    }
    
    const slug = file.name.replace('.md', '');
    
    return {
      slug: slug,
      filename: file.name,
      title: metadata.title || slug.replace(/-/g, ' '),
      description: metadata.description || '',
      date: metadata.date || '',
      author: metadata.author || '',
      image: metadata.image || '',
      categories: metadata.categories ? metadata.categories.split(',').map(c => c.trim()) : [],
      tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : [],
      draft: metadata.draft === 'true',
      file_size: file.size,
      last_modified: file.sha
    };
    
  } catch (error) {
    console.error(`Erreur getSingleRecipeFromFile pour ${file.name}:`, error);
    throw error; // ← Laisser l'erreur remonter
  }
}


// 🆕 FONCTION POUR LISTER LES FICHIERS SEULEMENT
async function listRecipeFiles(repoName, env) {
  const { GITHUB_TOKEN, REPO_OWNER } = env;
  const articlesUrl = `https://api.github.com/repos/${REPO_OWNER}/${repoName}/contents/content/recipes`;
  
  try {
    const response = await fetch(articlesUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API Error: ${response.status}`);
    }
    
    const files = await response.json();
    return files.filter(file => file.name.endsWith('.md') && file.type === 'file');
    
  } catch (error) {
    console.error('Erreur listRecipeFiles:', error);
    return [];
  }
}

// ===================================================================
// LOGS FINAUX
// ===================================================================

console.log('🚀 Worker Multi-Sites API v2.3-fixed - BUGS CORRIGÉS');
console.log('📊 Configuration:');
console.log(`- ${SAFE_FIELDS.length} champs sécurisés`);
console.log('- ✅ CORS sécurisé pour domaines personnalisés');
console.log('- ✅ Détection repo via registry');
console.log('- ✅ Normalisation domaines unifiée');
console.log('- ✅ Auto-modification sécurisée');
console.log('- ✅ Endpoint GET /api/get-config amélioré');
console.log('- ✅ Endpoint POST /api/update-config sécurisé');
console.log('- ✅ Parser YAML optimisé');
console.log('- ✅ Registry utilisé correctement');
