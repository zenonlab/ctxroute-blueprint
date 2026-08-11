import {expect,test,type Page,type Route} from '@playwright/test';

const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const media={id:'synthetic-media',title:'Titre synthétique',type:'MANGA',favoriteCount:1,coverUrl:null};

async function shell(page:Page){
  await page.route('**/api/v1/header-summary',route=>json(route,{role:'member',pendingReviewCount:0}));
  await page.route('**/api/v1/reviews?*',route=>json(route,{items:[],pendingCount:0}));
  await page.route('**/api/v1/reviews',route=>json(route,{items:[],pendingCount:0}));
}
async function libraryApi(page:Page,body:{items:Array<Record<string,unknown>&{id:string}>;total:number;nextOffset:number;hasMore:boolean}){
  await page.route('**/api/v1/library/**',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/facets')||path.includes('/related/')||path.endsWith('/source-check'))return route.fallback();if(path.endsWith('/cards'))return json(route,body);const id=decodeURIComponent(path.split('/').at(-1)??'');return json(route,body.items.find(item=>item.id===id)??body.items[0])});
}
const modalTransform=(dialog:ReturnType<Page['locator']>)=>dialog.locator('.physical-card-rotor').evaluate(node=>getComputedStyle(node).transform);

test('media click flips into a centred vertical modal without navigation and restores focus',async({page,isMobile})=>{
  test.skip(isMobile,'desktop geometry assertion');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items:[media],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');const trigger=page.getByRole('link',{name:'Aperçu de Titre synthétique'});await trigger.click({position:{x:8,y:12}});
  await expect(page).toHaveURL(/\/library$/);const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});await expect(dialog).toBeVisible();await expect(page.locator('.physical-card-modal')).toHaveCount(0);await expect(page.locator('.physical-card-slot.has-open-card > .media-card')).toHaveCount(1);const placeholder=page.locator('.physical-card-slot.has-open-card > .physical-card-placeholder');const slotBox=await placeholder.boundingBox();expect(slotBox?.width).toBeGreaterThan(0);expect(slotBox?.height).toBeGreaterThan(0);await page.waitForTimeout(550);const box=await dialog.boundingBox();expect(box!.width/box!.height).toBeCloseTo(2/3,1);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await trigger.click();const backdrop=page.getByTestId('media-card-backdrop');await expect(backdrop).toBeVisible();await expect(dialog).toHaveAttribute('data-modal-phase','open');await backdrop.click({position:{x:2,y:2}});await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/\/library$/);
  await trigger.press('Space');await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('data-modal-phase','open');await expect(dialog.getByRole('button',{name:'Fermer'})).toHaveCount(0);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
});

test('open modal remains fixed across background, tabs, links and action buttons',async({page,isMobile})=>{
  test.skip(isMobile,'fine pointer behavior');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  const reportable={...media,providerPages:[{provider:'mangaupdates',sourceUrl:'https://synthetic.invalid/work',status:'AVAILABLE'}],reporting:{identity:{subjectKey:'identity:synthetic-media',evidenceRevision:'synthetic-revision',state:'REPORTABLE',caseId:null},sources:[],reportableCount:1}};await libraryApi(page,{items:[reportable],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});await expect(dialog).toHaveAttribute('data-modal-phase','open');
  const box=await dialog.boundingBox(),samples=[];for(const position of [{x:box!.x+box!.width*.85,y:box!.y+box!.height*.18},{x:box!.x+box!.width*.15,y:box!.y+box!.height*.75}]){await page.mouse.move(position.x,position.y,{steps:40});samples.push(await modalTransform(dialog))}await dialog.getByRole('tab',{name:'Liens'}).click();for(const control of [dialog.getByRole('link',{name:/MangaUpdates/}),dialog.getByRole('button',{name:/Signaler un problème avec MangaUpdates/}),dialog.getByRole('button',{name:'Copier l’URL MangaUpdates'})]){const controlBox=await control.boundingBox();await page.mouse.move(controlBox!.x+controlBox!.width+20,controlBox!.y+controlBox!.height/2);await page.mouse.move(controlBox!.x-20,controlBox!.y+controlBox!.height/2,{steps:80});samples.push(await modalTransform(dialog))}expect(new Set(samples).size).toBe(1);await expect(dialog).not.toHaveAttribute('data-modal-tilt-state');
});

test('rapid background interactions cannot overlap card modal animations',async({page})=>{
  await shell(page);const items=[media,{...media,id:'synthetic-media-2',title:'Titre synthétique 2'}];
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items,total:items.length,nextOffset:items.length,hasMore:false});
  await page.goto('/library');const firstTrigger=page.getByRole('link',{name:'Aperçu de Titre synthétique',exact:true});const secondTrigger=page.getByRole('link',{name:'Aperçu de Titre synthétique 2',exact:true});await firstTrigger.click();let dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique',exact:true});const backdrop=page.getByTestId('media-card-backdrop');
  await backdrop.click({position:{x:2,y:2}});await expect(dialog).toHaveAttribute('data-modal-phase','opening');await page.keyboard.press('Escape');await backdrop.dispatchEvent('pointerdown');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(dialog).toHaveAttribute('data-modal-phase','opening');
  await expect(dialog).toHaveAttribute('data-modal-phase','open');await page.keyboard.press('Escape');await expect(dialog).toHaveAttribute('data-modal-phase','closing');await backdrop.dispatchEvent('pointerdown');await page.keyboard.press('Escape');await expect(backdrop).toBeVisible();
  await secondTrigger.evaluate(node=>(node as HTMLElement).click());await expect(page.getByRole('dialog')).toHaveCount(1);await expect(dialog).toHaveAttribute('data-modal-phase','closing');await expect(dialog).toHaveCount(0);await expect(page.getByTestId('media-card-backdrop')).toHaveCount(0);
  await secondTrigger.click();dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique 2',exact:true});await expect(dialog).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('report workflow performs the second cover-free turn and Escape restores details focus',async({page})=>{
  await shell(page);let submitted:unknown=null;const reportable={...media,reporting:{identity:{subjectKey:'identity:synthetic-media',evidenceRevision:'synthetic-revision',state:'REPORTABLE',caseId:null},sources:[],reportableCount:1}};
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[]}));
  await page.route('**/api/v1/reports',async route=>{submitted=await route.request().postDataJSON();await json(route,{ok:true,caseId:'00000000-0000-4000-8000-000000000001',status:'PENDING'},201)});
  await libraryApi(page,{items:[reportable],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog');const trigger=dialog.getByRole('button',{name:'Signaler un problème'});await trigger.click();await expect(dialog).toHaveClass(/is-secondary-flipped/);await expect(dialog.locator('.physical-card-rotor')).toHaveCSS('animation-name','modal-report-turn');await expect(dialog.locator('.media-card-secondary-rotor')).toHaveCSS('transform','none');const report=dialog.getByRole('region',{name:/Signaler un problème/});await expect(report.locator('img')).toHaveCount(0);await expect(report).toContainText('La fiche et les sites restent inchangés');if(!test.info().project.name.includes('mobile')){await report.hover();const reportBox=await report.boundingBox(),fixed=await modalTransform(dialog);await page.mouse.move(reportBox!.x+reportBox!.width*.4,reportBox!.y+reportBox!.height*.4);await page.mouse.move(reportBox!.x+reportBox!.width*.6,reportBox!.y+reportBox!.height*.6);expect(await modalTransform(dialog)).toEqual(fixed)}await page.keyboard.press('Escape');await expect(dialog).not.toHaveClass(/is-secondary-flipped/);await expect(dialog.locator('.media-card-secondary')).not.toHaveClass(/is-report-open/);await expect(trigger).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const reopened=page.getByRole('dialog');await reopened.getByRole('button',{name:/Signaler un problème avec/}).click();const reopenedReport=reopened.getByRole('region',{name:/Signaler un problème/});await expect(reopenedReport).toContainText('Quel est le problème avec cette œuvre ?');await expect(reopenedReport.getByRole('button',{name:'L’œuvre ou la partie est incorrecte'})).toHaveCount(0);const wrongIdentity=reopenedReport.getByRole('button',{name:'Mauvaise œuvre'});await wrongIdentity.click();await expect(wrongIdentity).toHaveAttribute('aria-pressed','true');const continueButton=reopenedReport.getByRole('button',{name:'Continuer'});await expect(continueButton).toBeEnabled();await continueButton.click();await expect(reopenedReport).toContainText('Vérification avant envoi');await reopenedReport.getByRole('button',{name:'Envoyer'}).click();await expect(reopenedReport).toContainText('Avertissement envoyé à l’admin');expect(submitted).toMatchObject({family:'IDENTITY',mediaId:'synthetic-media',reason:'WRONG_IDENTITY',evidenceRevision:'synthetic-revision'});
});

test('recommended-site report button opens reasons for that exact site',async({page})=>{
  await shell(page);const canonicalUrl='https://reader.example.test/work/synthetic';const sourceReportable={...media,sources:[{mediaId:'synthetic-media',connector:'synthetic',domain:'reader.example.test',canonicalUrl,workUrl:canonicalUrl,language:'fr',status:'AVAILABLE',title:'Titre synthétique',chapter:null,provenance:{}}],reporting:{identity:null,sources:[{subjectKey:'source:synthetic',evidenceRevision:'source-revision',canonicalUrl,domain:'reader.example.test',declaredLanguage:'fr',accessMode:'public',lastVerifiedAt:'2026-08-10T12:00:00.000Z',state:'REPORTABLE',caseId:null}],reportableCount:1}};
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[]}));
  await libraryApi(page,{items:[sourceReportable],total:1,nextOffset:1,hasMore:false});
  await page.route('**/api/v1/library/*/source-check',()=>new Promise<void>(()=>{}));
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Signaler un problème avec reader.example.test'}).click();const report=dialog.getByRole('region',{name:/Signaler un problème/});await expect(report).toContainText('Quel est le problème avec reader.example.test ?');await expect(report.getByRole('button',{name:'Un site recommandé est incorrect'})).toHaveCount(0);await expect(report.getByRole('button',{name:'La langue détectée est incorrecte'})).toBeVisible();
});

test('open modal preserves its live grid slot and flips back while returning after document scrolling',async({page,isMobile})=>{
  test.skip(isMobile,'desktop geometry assertion');await shell(page);const items=Array.from({length:24},(_,index)=>({...media,id:`synthetic-media-${index}`,title:`Titre synthétique ${index+1}`}));
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items,total:items.length,nextOffset:items.length,hasMore:false});
  await page.goto('/library');const trigger=page.getByRole('link',{name:'Aperçu de Titre synthétique 1',exact:true});const sourceBefore=await trigger.boundingBox();await trigger.click();const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique 1',exact:true});await expect(dialog).toBeVisible();const placeholder=page.locator('.physical-card-placeholder:visible');const placeholderBefore=await placeholder.boundingBox();expect(placeholderBefore?.width).toBeCloseTo(sourceBefore!.width,0);expect(placeholderBefore?.height).toBeCloseTo(sourceBefore!.height,0);expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');await expect(dialog).toHaveAttribute('data-modal-phase','open');
  await page.evaluate(()=>window.scrollBy(0,500));await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));const destination=await placeholder.boundingBox();expect(destination!.y).toBeLessThan(placeholderBefore!.y);const modalBeforeClose=await dialog.boundingBox();await page.keyboard.press('Escape');await page.waitForTimeout(120);const closingCard=page.locator('.physical-card.media-modal').first();const closingBox=await closingCard.boundingBox();expect(Math.abs(closingBox!.y-destination!.y)).toBeLessThan(Math.abs(modalBeforeClose!.y-destination!.y));expect(await closingCard.evaluate(node=>getComputedStyle(node).transform)).not.toBe('none');await expect(closingCard.locator('.physical-card-rotor')).toHaveAttribute('style',/rotateY\((?!180deg)/);await expect(dialog).toHaveCount(0);const returned=await trigger.boundingBox();expect(returned!.x).toBeCloseTo(destination!.x,0);expect(returned!.y).toBeCloseTo(destination!.y,0);
});

test.skip('legacy standalone review card is removed',async({page,isMobile})=>{
  test.skip(isMobile,'review cards flip on fine hover pointers');await shell(page);let decision:unknown=null;
  const review={id:'synthetic-review',favoriteTitle:'Favori synthétique',favoriteUrl:'https://source.example.test/favorite',provider:'anilist',status:'PENDING',google:{anilist:'https://google.example.test/a',mangaupdates:'https://google.example.test/m'},candidates:[{id:'candidate-1',providerId:'101',canonicalTitle:'Candidat synthétique',url:'https://provider.example.test/work',type:'MANGA',year:2026}]};
  await page.route('**/api/v1/reviews/synthetic-review/resolve',async route=>{decision=await route.request().postDataJSON();await json(route,{ok:true})});
  await page.route('**/api/v1/reviews/synthetic-review',route=>json(route,review));
  await page.goto('/review/synthetic-review');const card=page.locator('.review-candidate-shell');await card.hover({position:{x:24,y:28}});await expect(card).toHaveClass(/is-flipped/);await expect(card).toHaveClass(/is-tilting/);expect(parseFloat(await card.evaluate(node=>getComputedStyle(node).getPropertyValue('--tilt-x')))).not.toBe(0);expect(parseFloat(await card.evaluate(node=>getComputedStyle(node).getPropertyValue('--tilt-y')))).not.toBe(0);
  const rotor=card.locator('.physical-card-rotor');await expect(rotor).toHaveCSS('transform',/matrix3d/);const back=card.locator('.physical-card-back');const backActions=card.locator('.physical-card-back-actions');await expect(backActions).toHaveCSS('filter','brightness(1.14)');await expect(backActions).toHaveCSS('transform',/matrix\(1, 0, 0, 1, 0, -2\)/);const backBox=await back.boundingBox();const actionsBox=await backActions.boundingBox();expect(actionsBox!.x).toBeLessThanOrEqual(backBox!.x);expect(actionsBox!.y).toBeLessThanOrEqual(backBox!.y);expect(actionsBox!.x+actionsBox!.width).toBeGreaterThanOrEqual(backBox!.x+backBox!.width);expect(actionsBox!.y+actionsBox!.height).toBeGreaterThanOrEqual(backBox!.y+backBox!.height);
  const actions=card.locator('.physical-card-back-actions');const add=page.getByRole('button',{name:'Ajouter'});const source=page.getByRole('link',{name:'Source de l’œuvre'});await expect(source).toHaveAttribute('href','https://provider.example.test/work');expect(await add.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await source.evaluate(node=>node.clientWidth)).toBe(await actions.evaluate(node=>node.clientWidth));expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(255, 181, 46)');expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(11, 11, 14)');await expect(source).toHaveCSS('font-weight','800');await add.hover();await page.waitForTimeout(180);expect(await add.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(230, 161, 38)');expect(await add.locator('span').evaluate(node=>getComputedStyle(node).transform)).toContain('1.08');await source.hover();await page.waitForTimeout(180);expect(await source.evaluate(node=>getComputedStyle(node,'::before').backgroundColor)).toBe('rgb(39, 39, 49)');expect(await source.locator('span').evaluate(node=>getComputedStyle(node).transform)).toContain('1.08');await expect(source).toHaveCSS('text-decoration-line','none');await source.focus();await expect(source).toHaveCSS('outline-style','none');await expect(source).toHaveCSS('text-decoration-line','none');
  await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);await card.hover();await page.mouse.move(1,1);await card.hover();await expect(card).toHaveClass(/is-flipped/);await page.mouse.move(1,1);await expect(card).not.toHaveClass(/is-flipped/);
  await card.hover();await page.getByRole('button',{name:'Ajouter'}).click();expect(decision).toEqual({candidateId:'candidate-1'});
});

test('legacy review URLs redirect to the home page without loading a standalone resolver',async({page})=>{
  await shell(page);
  await page.goto('/review/synthetic-review');
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator('.review-page')).toHaveCount(0);
  await expect(page.locator('.review-candidate-shell')).toHaveCount(0);
});

test('modal credits create removable private author and studio filters',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items:[{...media,authors:[{name:'Synthetic Author',provider:'mangaupdates',sourceUrl:'https://provider.example.test/author'}],studios:[{name:'Synthetic Studio',provider:'anilist',sourceUrl:'https://provider.example.test/studio'}]}],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('tab',{name:'Informations'}).click();
  await dialog.getByRole('button',{name:'Synthetic Author'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'})).toBeVisible();await expect(page).toHaveURL(/author=Synthetic(?:\+|%20)Author/u);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre auteur Synthetic Author'})).toHaveCount(0);
  await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const reopened=page.getByRole('dialog');await reopened.getByRole('tab',{name:'Informations'}).click();await reopened.getByRole('button',{name:'Synthetic Studio'}).click();await expect(page.getByRole('button',{name:'Retirer le filtre studio Synthetic Studio'})).toBeVisible();await expect(page).toHaveURL(/studio=Synthetic(?:\+|%20)Studio/u);
});

test('reduced motion opens the final card state directly',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items:[media],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();await expect(page.getByRole('dialog')).toHaveCSS('transition-duration','0s');
});

test('library verso exposes its three accessible tabs and keeps parsed title provenance',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  const seasonTwo={id:'synthetic-media-season-2',title:'Titre parsé Saison 2',type:'ANIME',format:'TV',seasonYear:2026,sequenceOrder:1,relationTypes:['SEQUENCE_MEMBER'],coverUrl:null};const root={...media,type:'ANIME',title:'Titre parsé',rawTitle:'Titre brut interdit',favoriteCount:2,format:'TV',seasonYear:2025,status:'Ongoing',metadata:{provider:'synthetic-provider',metadata:{description:'<p>Synopsis propre et long.</p>',language:'fr'}},providerPages:[{provider:'anilist',sourceUrl:'https://synthetic.invalid/work',status:'AVAILABLE'}],progress:{kind:'episode',raw:'23',number:23,season:2,seasonMediaId:'synthetic-media-season-2',localNumber:3,globalNumber:23,updatedAt:'2026-01-01T00:00:00.000Z'},availability:{kind:'episode',raw:'5',number:5,provider:'synthetic-provider'},latestReleaseDate:'2999-01-01T00:00:00.000Z',sources:[],relatedWorks:[{id:'synthetic-media',title:'Titre parsé',type:'ANIME',format:'TV',seasonYear:2025,sequenceOrder:0,relationTypes:['CURRENT'],coverUrl:null},seasonTwo]};await libraryApi(page,{items:[root],total:1,nextOffset:1,hasMore:false});await page.route('**/api/v1/library/synthetic-media/related/synthetic-media-season-2',route=>json(route,{...root,...seasonTwo,relatedWorks:root.relatedWorks}));
  await page.goto('/library');
  await page.getByRole('link',{name:'Aperçu de Titre parsé'}).click();
  const dialog=page.getByRole('dialog',{name:'Aperçu de Titre parsé'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(3);await expect(dialog.locator('.media-card-back-heading h2')).toHaveText('Titre parsé Saison 2');await expect(dialog).toContainText('Progression · Partie 2 — épisode 3');await expect(dialog).not.toContainText('global 23');await expect(dialog).not.toContainText('Titre brut interdit');await expect(dialog).toContainText('AniList');await expect(dialog.locator('a[href="https://synthetic.invalid/work"]')).toHaveCount(1);await expect(dialog).not.toContainText('Disponibilité réelle');
  await dialog.locator('.media-card-related-toggle').click();const selectedPart=dialog.locator('.related-work-row.active');await expect(selectedPart).toHaveCount(1);await expect(selectedPart).toContainText('Titre parsé Saison 2');await expect(selectedPart).toContainText('Partie 2');await expect(selectedPart).toBeDisabled();await dialog.locator('.media-card-related-toggle').click();
  const copy=dialog.getByRole('button',{name:'Copier l’URL AniList'});await expect(copy).toHaveCSS('width','36px');await expect(copy).toHaveCSS('height','36px');await expect(copy.locator('svg')).toHaveCSS('pointer-events','none');await copy.hover();await expect(copy).toHaveCSS('background-color','rgb(39, 39, 49)');await copy.click();
  await dialog.getByRole('tab',{name:'Informations'}).click();await expect(dialog).toContainText('Synopsis propre et long.');
  const discoveriesTab=dialog.getByRole('tab',{name:'Découvertes'});await discoveriesTab.click();await expect(discoveriesTab).toHaveAttribute('aria-selected','true');await expect(dialog).toContainText('Aucune autre série reliée');
  if(!test.info().project.name.includes('mobile')){await dialog.getByRole('tab',{name:'Liens'}).focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('tab',{name:'Informations'})).toBeFocused();}
  await page.keyboard.press('Escape');if(!test.info().project.name.includes('mobile')){await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('link',{name:'Aperçu de Titre parsé'})).toBeFocused();}
});

test('proved parts use the selector while other relations stay in discoveries',async({page})=>{
  await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items:[{...media,relatedWorks:[{id:'synthetic-media',title:'Titre synthétique',type:'ANIME',format:'TV',seasonYear:2025,sequenceOrder:0,relationTypes:['CURRENT'],anilistId:'100',coverUrl:null},{id:'synthetic-sequel',title:'Suite synthétique',type:'ANIME',format:'ONA',seasonYear:2026,sequenceOrder:1,relationTypes:['SEQUENCE_MEMBER','SEQUEL'],anilistId:'101',coverUrl:null},{id:'synthetic-side',title:'Histoire synthétique',type:'ANIME',format:'SPECIAL',seasonYear:null,sequenceOrder:null,relationTypes:['SIDE_STORY'],anilistId:'102',coverUrl:null,status:'Ongoing',progress:{kind:'episode',raw:'3',number:3,updatedAt:'2026-01-01T00:00:00.000Z'},availability:{kind:'episode',raw:'5',number:5,provider:'synthetic-provider'}}]}],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).click();const dialog=page.getByRole('dialog',{name:'Aperçu de Titre synthétique'});
  const toggle=dialog.locator('.media-card-back-header > .media-card-related-toggle');await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(dialog.getByRole('tab')).toHaveCount(0);await expect(dialog.locator('.related-work-row')).toHaveCount(2);await expect(dialog.getByRole('region',{name:'Saisons et parties de la même œuvre'})).toContainText('Suite synthétique');await expect(dialog).toContainText('Partie 2');await expect(dialog).not.toContainText('ONA · 2026');await expect(dialog).not.toContainText('Histoire synthétique');
  await toggle.click();await expect(dialog.getByRole('tab')).toHaveCount(3);await dialog.getByRole('tab',{name:/Découvertes/}).click();await expect(dialog).toContainText('Histoire synthétique');await expect(dialog).toContainText('3 / 5');await expect(dialog).toContainText('Ongoing');
});

test('related navigation replaces every modal section, caps discoveries, handles errors, and resets on reopen',async({page})=>{
  await shell(page);const parts=Array.from({length:5},(_,index)=>({id:`synthetic-part-${index}`,title:`Partie synthétique ${index+1}`,type:'ANIME',format:'TV',seasonYear:2025+index,sequenceOrder:index,relationTypes:['SEQUENCE_MEMBER'],coverUrl:null}));const discoveries=Array.from({length:26},(_,index)=>({id:`synthetic-discovery-${index}`,title:`Découverte synthétique ${index+1}`,type:'ANIME',format:'SPECIAL',sequenceOrder:null,relationTypes:['SIDE_STORY'],coverUrl:null}));const root={...media,id:'synthetic-part-0',title:'Partie synthétique 1',type:'ANIME',relatedWorks:[...parts,...discoveries],favorites:[{bookmarkId:'root-favorite',url:'https://synthetic.invalid/root',title:'Raw',parsedTitle:'Favori racine',progression:null,device:'Synthetic',parserId:'shared',parserVersion:1,provenance:{}}]};
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await page.route('**/api/v1/library/synthetic-part-0/related/synthetic-part-1',route=>json(route,{...root,id:'synthetic-part-1',title:'Partie synthétique 2',format:'ONA',favorites:[],sources:[],providerPages:[],metadata:{provider:'anilist',metadata:{description:'Description remplacée'}},relatedWorks:[...parts,...discoveries]}));
  await libraryApi(page,{items:[root],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');const trigger=page.getByRole('link',{name:'Aperçu de Partie synthétique 1'});await trigger.click();let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:/Partie synthétique 1/}).click();await expect(dialog.locator('.related-work-row')).toHaveCount(5);await expect(dialog.locator('.related-work-row.active')).toBeDisabled();await dialog.getByRole('button',{name:/Partie synthétique 2/}).click();await expect(dialog.locator('.media-card-back-header .media-card-back-heading h2')).toHaveText('Partie synthétique 2');await expect(dialog.locator('.media-card-back-content')).toHaveAttribute('aria-busy','false');await expect(dialog).not.toContainText('Favori racine');await expect(dialog.getByRole('tab',{name:/Liens/})).toHaveAttribute('aria-selected','true');
  await dialog.getByRole('tab',{name:/Découvertes/}).click();await expect(dialog.locator('.related-work-card')).toHaveCount(24);
  const discovery=dialog.locator('.related-work-card').first();
  if(!test.info().project.name.includes('mobile')){
    const discoveryBox=await discovery.boundingBox();const sibling=dialog.locator('.related-work-card').nth(1),parentTransform=await modalTransform(dialog);
    await expect(discovery).toHaveCSS('cursor','pointer');await expect(discovery.locator('.poster')).toHaveCSS('cursor','pointer');await expect(discovery.locator('.poster-copy strong')).toHaveCSS('cursor','pointer');
    await discovery.hover({position:{x:discoveryBox!.width*.35,y:discoveryBox!.height*.35}});await expect(discovery).toHaveClass(/is-discovery-tilting/);await page.waitForTimeout(500);await expect(discovery).toHaveClass(/is-discovery-tilting/);await expect(discovery).toHaveCSS('cursor','pointer');
    const nestedTilt=await discovery.evaluate(node=>[parseFloat(getComputedStyle(node).getPropertyValue('--discovery-tilt-x')),parseFloat(getComputedStyle(node).getPropertyValue('--discovery-tilt-y'))]);
    expect(nestedTilt.some(value=>Math.abs(value)>.1)).toBeTruthy();expect(parentTransform).toBe(await modalTransform(dialog));
    await expect(discovery.locator('.poster > .poster-visual')).toHaveCSS('filter','brightness(0.72)');await expect(sibling.locator('.poster > .poster-visual')).toHaveCSS('filter','none');
    await page.mouse.move(1,1);await expect(discovery).not.toHaveClass(/is-discovery-tilting/);
  }
  await page.route('**/api/v1/library/synthetic-part-0/related/synthetic-discovery-0',route=>route.abort());await discovery.click();await expect(dialog).toContainText('Impossible de charger cette œuvre');await expect(dialog.locator('.media-card-back-header .media-card-back-heading h2')).toHaveText('Partie synthétique 2');
  await page.keyboard.press('Escape');await trigger.click();dialog=page.getByRole('dialog');await expect(dialog).toContainText('Partie synthétique 1');await expect(dialog).not.toContainText('Partie synthétique 2');
});

test('touch tap opens and closes the media card',async({page,isMobile})=>{
  test.skip(!isMobile,'touch project only');await shell(page);
  await page.route('**/api/v1/library/facets*',route=>json(route,{types:[],themes:[],genres:[],categories:[],statuses:[],years:[],contentRatings:[],demographics:[]}));
  await libraryApi(page,{items:[media],total:1,nextOffset:1,hasMore:false});
  await page.goto('/library');await page.getByRole('link',{name:'Aperçu de Titre synthétique'}).tap();await expect(page.getByRole('dialog')).toBeVisible();await page.getByTestId('media-card-backdrop').tap({position:{x:2,y:2}});await expect(page.getByRole('dialog')).toHaveCount(0);
});
