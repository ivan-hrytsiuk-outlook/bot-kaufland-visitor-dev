import {
    Browser,
    ElementHandle,
    Locator,
    Page,
    Target,
    TimeoutError,
} from 'puppeteer';
import fs from 'fs';

export interface IProductInfo {
    // information about target product
    shopName: string;
    shopUrl: string;
    shopId: string;
    productId: string;
    price: number;
    productUrl: string;
    title: string;
    variations?: { id: string }[]; // list of variation product IDS found on product's page
}

export interface IProductActionsResult {
    foundOnPage?: number;
    productId: string; // product id
    addToCart?: { before: boolean; after: boolean }; // was this product in cart before this run and after
    error?: string; // text of error that  happened while do actions on this product
    timeOnPage?: number; // seconds that bot spent on main products page: from moment it was  actually loaded
}

export interface IProductAction {
    addToCart: boolean; // should product be added to cart
    minTimeOnPage: number; // what min time in seconds bot should stay on product's page doing various activity
}

export interface IKauflandRankingTask {
    isAnonymous: boolean; // is run anonymously without logged in profile. profile is null otherwise profile must be set
    profile?: {
        name: string;
        password: string;
        email: string;
    };
    location: 'de' | 'bg' | 'cz' | 'hr' | 'pl' | 'md' | 'ro' | 'sk';
    productAction: IProductAction & {
        searchCriteria: {
            keyword: string;
            numberPagesToSearch: number; // how many serp must be iterated
            minPrice?: number;
            maxPrice?: number;
        };

        productId: string;
        // list of product IDS that can be considered as main. So if any of those were found and visited task is succeed.
        variationIds?: string[];
        // if product was not found  should we directly visit product to get and return its info
        productInfoOnNotFound: boolean;
        // how many random products should be visited on each page and what activity should be done
        randomProductVisitsPerPage: IProductAction[][];
    };
}

export interface IKauflandRankingTaskResult {
    totalResultPages?: number; // how many total pages in serp
    totalResultItems?: number; // how many total items in result reported by kaufland
    foundOnPage?: number; // on which page main product or its variation was found
    foundId?: string; // ID of main product or its variation that was found
    isFoundVariationId: boolean; // true if  ID of main product was found. false if variation ID was found.
    foundBySearch: boolean; // true if main product or its variation was found with normal search
    isFoundAdvertised: boolean;

    cart: {
        itemsCountBefore: number;
        itemsCountAfter: number;
    };
    // main product information.
    productInfo?: IProductInfo;
    // results of activity on main product page (or its variation)
    mainProductPageActions: IProductActionsResult;
    // any other products that were visited while search
    otherProducts: IProductActionsResult[];
}

export interface IBotContext {
    browser: Browser;
    task: IKauflandRankingTask;
}

export interface IBot {
    // handle(context: IBotContext): Promise<IKauflandRankingTaskResult>;
    handle(context: IBotContext): Promise<IKauflandRankingTaskResult>;
}

interface CartStatus {
    totalCount: number;
    productIds: string[];
}
async function setPageViewPort(page: Page) {
    return page.setViewport({
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        isMobile: false,
    });
}
async function waitForPageInitLoad(page: Page) {
    const selector = await Promise.race([
        page.waitForSelector('.rh-main__logo'),
        page.waitForSelector('.main-wrapper>.main-content>.zone-name-title'),
    ]);
    if (selector === null) {
        errorLog('waitForPageInitLoad:Ln111=> Invalid selector');
    } else {
        const className = await selector.evaluate((el) => el.className);
        if (className.includes('zone-name-title')) {
            infoLog(`Anti-bot detected: ${page.url()}`);
            await page.reload();
        }
    }
}
async function waitSkeletonLoading(page: Page) {
    await page.waitForFunction(
        () =>
            document.querySelectorAll('.rd-skeleton, .rd-placeholder')
                .length === 0
    );
}

function hideCookieAlertIfItAppears(mainPage: Page) {
    // Click Cookie Accept Button if the alert is displayed
    mainPage
        .locator('#onetrust-accept-btn-handler')
        //.setTimeout(100)
        .waitHandle()
        .then(async (acceptBtn) => {
            if (!acceptBtn) {
                throw new Error('Null accept Btn');
            }
            infoLog('Cookie alert is shown');
            await acceptBtn.click();
            infoLog('Cookie Accept button is clicked');
        })
        .catch(async (error) => {
            if (error instanceof TimeoutError)
                infoLog('Cookie alert is not displayed');
            else errorLog('Unknown error: ' + error);
            await saveScreenshot(mainPage);
            await savePageContent(mainPage);
        });
}
async function saveScreenshot(page: Page, suffix: string = '') {
    try {
        const dt = new Date();
        const filename =
            [dt.getHours(), dt.getMinutes(), dt.getSeconds()]
                .map((val) => val.toString().padStart(2, '0'))
                .join('') +
            suffix +
            '.png';
        debugLog(`screenshot(${page.url()}) is saved to ${filename}`);
        await page.screenshot({ path: filename, fullPage: true });
    } catch (error) {
        errorLog('saveScreenshot:Ln146=>', error);
    }
}
async function savePageContent(page: Page, suffix: string = '') {
    try {
        const dt = new Date();
        const filename =
            [dt.getHours(), dt.getMinutes(), dt.getSeconds()]
                .map((val) => val.toString().padStart(2, '0'))
                .join('') +
            '_' +
            dt.getMilliseconds().toString().padStart(3, '0') +
            suffix +
            '.html';
        debugLog(`page content(${page.url()}) is saved to ${filename}`);
        const content = await page.content();
        fs.writeFileSync(filename, content);
    } catch (error) {
        errorLog('saveScreenshot:Ln146=>', error);
    }
}
const currentTime = () => {
    const padL = (nr: any, len = 2, chr = `0`) => `${nr}`.padStart(len, chr);
    const dt = new Date();
    return (
        `${padL(dt.getMonth() + 1)}/${padL(
            dt.getDate()
        )}/${dt.getFullYear()} ${padL(dt.getHours())}:${padL(
            dt.getMinutes()
        )}:${padL(dt.getSeconds())}` +
        '.' +
        padL(dt.getMilliseconds(), 3)
    );
};
const debugLog = (...args: any[]) =>
    console.log(currentTime(), '\x1b[34m', ...args, '\x1b[0m'); // blue log

const infoLog = (...args: any[]) =>
    console.info(currentTime(), '\x1b[32m', ...args, '\x1b[0m'); // green log

const errorLog = (...args: any[]) =>
    console.error(currentTime(), '\x1b[31m', ...args, '\x1b[0m'); // green log

const sleep = (delay: number) =>
    new Promise((resolve) => setTimeout(resolve, delay));

export class KauflandBot implements IBot {
    browser!: Browser;
    task!: IKauflandRankingTask;
    taskResult!: IKauflandRankingTaskResult;

    getBaseUrl() {
        // Main Step3: Country Assertion: Verify the correct country (e.g., kaufland.de, kaufland.nl).
        return `https://www.kaufland.${this.task.location}`;
    }

    async checkProfile(mainPage: Page) {
        // Main Step2: Profile Check
        const accountLogin: ElementHandle = await Promise.race([
            mainPage.locator('.rd-aw-login-entry>button').waitHandle(),
            mainPage.locator('.rd-aw-login-entry>a').waitHandle(),
            mainPage.locator('.rd-aw-login-entry>span').waitHandle(),
        ]);
        const tagName = await accountLogin.evaluate((el) =>
            el.tagName.toLowerCase()
        );
        const isLoggedIn = tagName === 'button';
        if (this.task.isAnonymous) {
            if (isLoggedIn) {
                errorLog(
                    'Profie Mismatch:  Anonymous user is expected but profile is logged in'
                );
            } else {
                infoLog('Anonymouse profile matched');
            }
        } else {
            if (!isLoggedIn) {
                errorLog('profile Mismatch:  Profile should be logged in');
            } else {
                infoLog('Profile is logged in');
            }
        }
    }

    async getCartStatus(): Promise<CartStatus> {
        // Main Step4: Retrieve Cart Count: Count the products in the cart before starting.
        const cartPage = await this.browser.newPage();
        await cartPage.goto(`${this.getBaseUrl()}/checkout/cart`);
        await setPageViewPort(cartPage);
        await waitForPageInitLoad(cartPage);
        await waitSkeletonLoading(cartPage);
        const cartHandle: ElementHandle = await Promise.race([
            cartPage.locator('.empty-cart').waitHandle(),
            cartPage.locator('.filled-cart .article-counter').waitHandle(),
        ]);
        const cartClassName = await cartHandle.evaluate((el) => el.className);
        let totalCount = 0;
        let productIds: string[] = [];
        if (cartClassName !== 'empty-cart') {
            const textContent = await cartHandle.evaluate(
                (el) => el.textContent
            );
            if (textContent === null) {
                errorLog('TextContent of cart article should not be null');
            } else {
                totalCount = Number(
                    textContent
                        .replace('(', '')
                        .replace(')', '')
                        .trim()
                        .split(' ')[0]
                );
                const pictureLinks = await cartPage.$$(
                    '.unit-widget-unit__picture-link'
                );
                await Promise.all(
                    pictureLinks.map(async (pictureLink) =>
                        productIds.push(
                            (await pictureLink.evaluate((link) =>
                                link.getAttribute('href')
                            )) || ''
                        )
                    )
                );
                productIds = productIds.map((productId) => {
                    if (
                        !productId.startsWith('/product/') ||
                        productId.trim().split('/').length < 2
                    ) {
                        errorLog(
                            "getCartStatus:Ln208=> Invalid product link. Couldn't get productId",
                            productId
                        );
                    }
                    return productId.trim().split('/')[2];
                });
            }
        }
        await cartPage.close();
        return { totalCount, productIds };
    }

    async inputSearchFilters(mainPage: Page) {
        const { taskResult, task } = this;
        // Step5: Input Search Criteria: Enter the keyword and other search filter values.
        const { keyword, minPrice, maxPrice } =
            task.productAction.searchCriteria;
        const searchInputHandle = await mainPage
            .locator('input.rh-search__input')
            .waitHandle();
        await searchInputHandle.type(keyword);
        await searchInputHandle.press('Enter');

        await mainPage.waitForFunction(
            () =>
                document.querySelectorAll(
                    '.range-filter__input input.rd-input__input'
                ).length === 2
        );

        if (minPrice !== undefined || maxPrice !== undefined) {
            const elements = await mainPage.$$(
                '.range-filter__input input.rd-input__input'
            );

            // Fill values into the elements
            if (minPrice !== undefined)
                await elements[0].type(minPrice.toString());
            if (maxPrice !== undefined)
                await elements[1].type(maxPrice.toString());
            await elements[1].press('Enter');
        }

        // Step6. Validate Filters: Assert that all filter data is correctly input and reflected in the result pages.
        const inputedSearchFilter = await mainPage
            .locator('input.rh-search__input')
            .map((input: HTMLInputElement) => input.value)
            .wait();
        if (inputedSearchFilter === keyword)
            infoLog(`${keyword} is inputed to search filter`);
        else {
            errorLog(
                `${keyword} is NOT inputed to search filter: ${inputedSearchFilter}`
            );
        }

        if (minPrice !== undefined) {
            const inputedMinValueFilter = await mainPage
                .locator(
                    '.range-filter__input:nth-of-type(1) input.rd-input__input'
                )
                .map((input: HTMLInputElement) => input.value)
                .wait();
            if (minPrice === Number(inputedMinValueFilter)) {
                infoLog(`${minPrice} is inputed to search filter`);
            } else {
                errorLog(
                    `${minPrice} is NOT inputed to search filter: ` +
                        inputedMinValueFilter
                );
            }
        }

        if (maxPrice !== undefined) {
            const inputedMaxValueFilter = await mainPage
                .locator(
                    '.range-filter__input:nth-of-type(2) input.rd-input__input'
                )
                .map((input: HTMLInputElement) => input.value)
                .wait();
            if (maxPrice === Number(inputedMaxValueFilter)) {
                infoLog(`${maxPrice} is inputed to search filter`);
            } else {
                errorLog(
                    `${maxPrice} is NOT inputed to search filter: ` +
                        inputedMaxValueFilter
                );
            }
        }

        const searchedHandle = await Locator.race([
            mainPage
                .locator('.product-count.result-header__product-count')
                .filter((el) => el.textContent?.trim() !== ''),
            mainPage.locator('.empty-search__notification'),
        ]).waitHandle();

        if (
            await searchInputHandle.evaluate((el) =>
                el.classList.contains('empty-search__notification')
            )
        ) {
            errorLog('Any matching search results');
            taskResult.totalResultItems = 0;
            taskResult.totalResultPages = 0;
        } else {
            taskResult.totalResultItems =
                Number(
                    (await searchedHandle.evaluate((el) => el.textContent))
                        ?.replace('.', '')
                        .replace('+', '')
                        .trim()
                        .split(' ')[0]
                ) || 1;
            await waitSkeletonLoading(mainPage);
            // if (taskResult.totalResultItems >= 40) {
            //     //TODO: 40 is the number of products on each page?
            //     await mainPage.waitForFunction(() => {
            //         return (
            //             document.querySelectorAll('.rd-page--static').length ===
            //             2
            //         );
            //     });
            const pages = await mainPage.$$('.rd-page--page');
            if (pages.length) {
                taskResult.totalResultPages = Number(
                    (
                        await pages[pages.length - 1].evaluate(
                            (el) => el.textContent
                        )
                    )?.trim()
                );
            } else {
                taskResult.totalResultPages = 1;
            }
        }
    }

    async nextOrPrevPage(mainPage: Page, toNext: boolean = true) {
        if (this.taskResult.totalResultPages === 1) {
            if (toNext) return 2;
            else return 0;
        }
        const currentPage = await this.getCurrentPageNumber(mainPage);
        await mainPage.waitForFunction(
            () =>
                document.querySelectorAll('button.rd-page--static').length === 2
        );
        if (toNext) {
            await mainPage.locator('button.rd-page--static:last-child').click();
        } else {
            await mainPage
                .locator('button.rd-page--static:first-child')
                .click();
        }
        const targetPage = currentPage + (toNext ? 1 : -1);
        await mainPage.waitForFunction(
            (targetPage: number) => {
                return (
                    Number(
                        document
                            .querySelector('span.rd-page--current')
                            ?.textContent?.trim()
                    ) === targetPage
                );
            },
            {},
            targetPage
        );
        return targetPage;
    }

    async getCurrentPageNumber(mainPage: Page) {
        if (this.taskResult.totalResultPages === 1) return 1;
        return Number(
            (
                await mainPage
                    .locator('span.rd-page--current')
                    .map((el) => el.textContent)
                    .wait()
            )?.trim()
        );
    }

    async moveAroundElementBoxOnProductPage(
        productPage: Page,
        selector: string,
        numberOfMovement: number
    ) {
        const elem = await productPage.waitForSelector(selector, {
            visible: true,
        });
        if (elem === null) {
            errorLog(
                `moveAroundElementBoxOnProductPage:Ln423=> Invalid selector(${selector}) element`
            );
        } else {
            await elem.hover();
            const boundingBox = await elem.boundingBox();
            if (boundingBox) {
                for (let i = 0; i < numberOfMovement; i++) {
                    await productPage.mouse.move(
                        boundingBox.x + Math.random() * boundingBox.width,
                        boundingBox.y + Math.random() * boundingBox.height
                    );
                    await sleep(Math.floor(Math.random() * 300 + 400));
                }
            }
        }
    }

    async getProductInfo(
        productPage: Page,
        productId: string,
        productUrl: string
    ) {
        const productInfo: IProductInfo = {
            productId,
            productUrl,
            shopName: '',
            shopUrl: '',
            shopId: '',
            price: 0,
            title: '',
        };
        const title =
            (await productPage
                .locator('.rd-title')
                .map((el) => el.textContent)
                .wait()) || '';
        if (title === '') {
            errorLog(
                `getProductInfo=> Product(ID:${productInfo.productId}, URL:${productInfo.productUrl}) Title cannot be null`
            );
        }
        productInfo.title = title;
        const priceTextContent = await productPage
            .locator('.rd-price-information__price')
            .map((el) => el.textContent)
            .wait();
        productInfo.price = Number(
            priceTextContent
                ?.replace('.', '')
                .replace(',', '.')
                .replace('€', '')
                .trim()
        );

        const variations: { id: string }[] = [];
        const variantBoxes = await productPage.$$('div.rd-variant__option-box');
        await Promise.all(
            variantBoxes.map(async (element) => {
                const dataPW =
                    (
                        await element.evaluate((ele) =>
                            ele.getAttribute('data-pw')
                        )
                    )?.trim() || '';
                if (!dataPW.startsWith('variant-')) {
                    errorLog(
                        `getProductInfo=> Invalid variant attribute: ${dataPW}`
                    );
                } else {
                    variations.push({ id: dataPW.replace('variant-', '') });
                }
            })
        );
        productInfo.variations = variations;

        // TODO: shopId, shopUrl, shopName will be later.
        return productInfo;
    }
    async visitAndDoHumanActivity(
        productATag: ElementHandle,
        productId: string,
        foundOnPage: number,
        productAction: IProductAction
    ): Promise<
        [productPage: Page, productActionResult: IProductActionsResult]
    > {
        const [productPage] = await Promise.all([
            new Promise<Page>((resolve) => {
                const handleTarget = async (target: any) => {
                    if (target.type() === 'page') {
                        this.browser.off('targetcreated', handleTarget);
                        const page = await target.page();
                        if (page === null) {
                            errorLog(
                                'exploreSERP:Ln686=> Invalid page created'
                            );
                        } else resolve(page);
                    }
                };
                this.browser.on('targetcreated', handleTarget);
            }),
            productATag.click({ button: 'middle' }),
        ]);
        await setPageViewPort(productPage);
        await waitForPageInitLoad(productPage);
        await productPage.bringToFront();
        await waitSkeletonLoading(productPage);
        return [
            productPage,
            await this.doProductAction(
                productPage,
                productId,
                foundOnPage,
                productAction
            ),
        ];
    }
    async doProductAction(
        productPage: Page,
        productId: string,
        foundOnPage: number,
        productAction: IProductAction
    ): Promise<IProductActionsResult> {
        const productActionResult: IProductActionsResult = {
            productId,
            foundOnPage,
        };
        try {
            const { addToCart, minTimeOnPage } = productAction;
            const startTime = performance.now();
            let currentTime;
            do {
                currentTime = performance.now();
                const RANDOM_ACTION_COUNT = 3;
                const randomAction = Math.floor(
                    Math.random() * RANDOM_ACTION_COUNT
                );
                switch (randomAction) {
                    case 0:
                        infoLog(
                            `Mouse is moving randomly around short description text...`
                        );
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            '.description-teaser__description-text',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    case 1:
                        infoLog(
                            `Mouse is moving randomly around product picture...`
                        );
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            'picture.product-picture',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    case 2:
                        infoLog(
                            `Mouse is moving randomly around long description...`
                        );
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            '.rd-product-description__top-accordion-content-description',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    default:
                        errorLog('Invalid random product page action');
                }
            } while (currentTime - startTime < minTimeOnPage * 1000);
            productActionResult.timeOnPage = Math.floor(
                (currentTime - startTime) / 1000
            );
            const beforeStatus: CartStatus = await this.getCartStatus();
            productActionResult.addToCart = {
                before: beforeStatus.productIds.includes(
                    productActionResult.productId
                ),
                after: false,
            };
            await productPage.bringToFront();
            if (addToCart) {
                const cartButton = await productPage.waitForSelector(
                    '.rd-add-to-cart__button',
                    {
                        visible: true,
                    }
                );
                if (cartButton === null) {
                    errorLog(
                        `doProductAction:Ln617=> cannot find add-to-cart-button`
                    );
                } else {
                    do {
                        await cartButton.click();
                        await sleep(Math.random() * 1000 + 1000);
                    } while (
                        (await productPage.evaluate(
                            () =>
                                document.querySelectorAll(
                                    '.add-to-cart-overlay__body'
                                ).length
                        )) == 0
                    );
                    await productPage.waitForSelector(
                        '.add-to-cart-overlay__body',
                        { visible: true }
                    );
                    await sleep(Math.random() * 1000 + 1000);
                    await productPage
                        .locator('.add-to-cart-overlay__close')
                        .click();
                    await sleep(Math.random() * 1000 + 1000);
                }
            }

            const afterStatus: CartStatus = await this.getCartStatus();
            productActionResult.addToCart.after =
                afterStatus.productIds.includes(productActionResult.productId);
            if (addToCart) {
                if (afterStatus.totalCount > beforeStatus.totalCount) {
                    infoLog(
                        `Product(Id: ${productActionResult.productId}) is added to cart(before:${beforeStatus.totalCount}, after:${afterStatus.totalCount})`
                    );
                } else {
                    errorLog(
                        `${productActionResult.productId} should be added to cart but NOT added!`
                    );
                }
            }
        } catch (error) {
            await saveScreenshot(productPage);
            await savePageContent(productPage);
            if (error instanceof Error) {
                errorLog(
                    `doProductAction=>productId: ${productId}, foundOnPage:${foundOnPage}`,
                    error
                );
                productActionResult.error = error.toString();
            } else {
                errorLog(
                    `doProductAction=>productId: ${productId}, foundOnPage:${foundOnPage} Unknown error:`,
                    error
                );
                productActionResult.error = JSON.stringify(error, null, 2);
            }
        }
        return productActionResult;
    }

    async exploreSERP(mainPage: Page) {
        const { task, taskResult } = this;
        if (taskResult.totalResultPages) {
            let currentPageNumber = 1;
            while (
                currentPageNumber <=
                Math.min(
                    taskResult.totalResultPages,
                    task.productAction.searchCriteria.numberPagesToSearch
                )
            ) {
                const currentPageSpanValue = await this.getCurrentPageNumber(
                    mainPage
                );
                if (currentPageSpanValue !== currentPageNumber) {
                    errorLog(
                        `current page is incorrect=> ${currentPageNumber} expected but ${currentPageSpanValue}. Will navigate to the target page`
                    );
                    await this.nextOrPrevPage(
                        mainPage,
                        currentPageSpanValue < currentPageNumber
                    );
                    continue;
                }
                await mainPage.waitForFunction(
                    () =>
                        document.querySelectorAll('article.product').length > 0
                );
                const allProducts = await mainPage.$$('article.product');
                infoLog(
                    `Searching ${currentPageNumber}th page(${allProducts.length} products)...`
                );
                // Explore random products
                let randomProductActionsToVisit: IProductAction[] = [];
                if (
                    currentPageNumber <=
                    task.productAction.randomProductVisitsPerPage.length
                )
                    randomProductActionsToVisit =
                        task.productAction.randomProductVisitsPerPage[
                            currentPageNumber - 1
                        ];
                let randomProductIndex = 0;

                for (
                    let productIndex = 0;
                    productIndex < allProducts.length;
                    productIndex++
                ) {
                    const product = allProducts[productIndex];
                    await product.hover();
                    //TEST await sleep(Math.random() * 500 + 500);
                    const productATag = await product.waitForSelector('a');
                    if (productATag === null) {
                        errorLog(
                            `exploreSERP:Ln625=> No validate product link of ${productIndex}-index product of ${currentPageNumber}th page`
                        );
                        continue;
                    }
                    const productUrl =
                        (
                            await productATag.evaluate((el) => {
                                return el.getAttribute('href');
                            })
                        )?.trim() || '';
                    const splitedProductUrl: string[] =
                        productUrl?.split('/') || [];
                    if (
                        splitedProductUrl?.length < 3 ||
                        splitedProductUrl[0] !== '' ||
                        splitedProductUrl[1] !== 'product'
                    ) {
                        errorLog(
                            `Invalid product url: ${splitedProductUrl} - ${productUrl} - ${productIndex}-index item on ${currentPageNumber}-index page`
                        );
                    } else {
                        const productId = splitedProductUrl[2];
                        const isAdvertisedProduct =
                            (await product.$(
                                'div.product__sponsored-ad-label'
                            )) !== null;
                        isAdvertisedProduct &&
                            infoLog(
                                `Advertised product is found at ${productIndex}-index item on ${currentPageNumber}-index page. It won't be visited`
                            );
                        const isMainProduct =
                            task.productAction.productId === productId ||
                            task.productAction.variationIds?.includes(
                                productId
                            );
                        if (isAdvertisedProduct) {
                            if (isMainProduct) {
                                taskResult.isFoundAdvertised = true;
                            }
                            continue;
                        }
                        if (isMainProduct) {
                            infoLog(
                                `MainProduct is founded at ${productIndex}-index on ${currentPageNumber}th page`
                            );
                            taskResult.mainProductPageActions.foundOnPage =
                                taskResult.foundOnPage = currentPageNumber;
                            taskResult.foundId = productId;
                            taskResult.isFoundVariationId =
                                task.productAction.productId !== productId;
                            taskResult.foundBySearch = true;
                            infoLog(
                                `MainProduct(id:${productId}) is visiting...`
                            );
                            const [productPage, productActionResult] =
                                await this.visitAndDoHumanActivity(
                                    productATag,
                                    productId,
                                    currentPageNumber,
                                    task.productAction
                                );
                            infoLog(
                                `MainProduct(id:${productId}) is visited.\r\nAction: ${JSON.stringify(
                                    task.productAction,
                                    null,
                                    2
                                )}\r\nActionResult:${JSON.stringify(
                                    productActionResult,
                                    null,
                                    2
                                )}`
                            );

                            taskResult.productInfo = await this.getProductInfo(
                                productPage,
                                productId,
                                productUrl
                            );
                            taskResult.mainProductPageActions =
                                productActionResult;
                            await mainPage.bringToFront();
                            await productPage.close();
                            infoLog(
                                `MainProduct Information is scrapped successfully.\r\nProduct Info:${JSON.stringify(
                                    taskResult.productInfo,
                                    null,
                                    2
                                )}`
                            );
                        } else if (
                            Math.random() <
                            (randomProductActionsToVisit.length -
                                randomProductIndex) /
                                (allProducts.length - productIndex)
                        ) {
                            infoLog(
                                `RandomProduct(id: ${productId} at ${productIndex}-index on ${currentPageNumber}th page) is visiting...`
                            );
                            const [productPage, productActionResult] =
                                await this.visitAndDoHumanActivity(
                                    productATag,
                                    productId,
                                    currentPageNumber,
                                    randomProductActionsToVisit[
                                        randomProductIndex
                                    ]
                                );
                            await mainPage.bringToFront();
                            await productPage.close();
                            infoLog(
                                `RandomProduct(id: ${productId} at ${productIndex}-index on ${currentPageNumber}th page) is visited.\r\nAction: ${JSON.stringify(
                                    randomProductActionsToVisit[
                                        randomProductIndex
                                    ],
                                    null,
                                    2
                                )}\r\nActionResult:${JSON.stringify(
                                    productActionResult,
                                    null,
                                    2
                                )}`
                            );
                            randomProductIndex++;
                            taskResult.otherProducts.push(productActionResult);
                        }
                    }
                }
                currentPageNumber = await this.nextOrPrevPage(mainPage);
            }
        }
        if (!taskResult.foundBySearch) {
            const { productId } = task.productAction;
            const productUrl = `${this.getBaseUrl()}/product/${productId}`;
            const productPage = await this.browser.newPage();
            await productPage.goto(productUrl);
            await setPageViewPort(productPage);
            await waitForPageInitLoad(productPage);
            await waitSkeletonLoading(productPage);
            taskResult.productInfo = await this.getProductInfo(
                productPage,
                productId,
                productUrl
            );
            productPage.close();
        }
    }

    async handle(context: IBotContext): Promise<IKauflandRankingTaskResult> {
        // setInterval(async () => {
        //     const pages = await this.browser.pages();
        //     debugLog('Total browser pages:', pages.length);
        //     Promise.all([
        //         pages.map(
        //             async (page, index) =>
        //                 await saveScreenshot(page, `_${index}`)
        //         ),
        //     ]);
        // }, 5000);
        // Init Properties
        this.task = context.task;
        this.taskResult = {
            isFoundVariationId: false,
            foundBySearch: false,
            isFoundAdvertised: false,

            cart: {
                itemsCountBefore: 0,
                itemsCountAfter: 0,
            },
            mainProductPageActions: {
                productId: '',
            },
            otherProducts: [],
        };
        this.browser = context.browser;
        const mainPage = await this.browser.newPage();
        await mainPage?.goto(this.getBaseUrl());
        await setPageViewPort(mainPage);
        await waitForPageInitLoad(mainPage);
        await waitSkeletonLoading(mainPage);
        try {
            // Actions
            hideCookieAlertIfItAppears(mainPage);
            await this.checkProfile(mainPage);

            const cartStatusBefore: CartStatus = await this.getCartStatus();
            infoLog('Cart Status(Before):', cartStatusBefore);

            await this.inputSearchFilters(mainPage);
            infoLog(
                `Total result items:${this.taskResult.totalResultItems}, total pages: ${this.taskResult.totalResultPages}`
            );
            await this.exploreSERP(mainPage);

            const cartStatusAfter: CartStatus = await this.getCartStatus();
            infoLog('Cart Status(After):', cartStatusAfter);

            this.taskResult.cart.itemsCountBefore = cartStatusBefore.totalCount;
            this.taskResult.cart.itemsCountAfter = cartStatusAfter.totalCount;
            this.taskResult.mainProductPageActions.addToCart = {
                before: cartStatusBefore.productIds.includes(
                    this.task.productAction.productId
                ),
                after: cartStatusAfter.productIds.includes(
                    this.task.productAction.productId
                ),
            };
            this.taskResult.otherProducts.forEach(
                (otherProduct) =>
                    (otherProduct.addToCart = {
                        before: cartStatusBefore.productIds.includes(
                            otherProduct.productId
                        ),
                        after: cartStatusAfter.productIds.includes(
                            otherProduct.productId
                        ),
                    })
            );
            await mainPage.close();
        } catch (error) {
            errorLog('handle():Ln949=>', error);
            await saveScreenshot(mainPage);
            await savePageContent(mainPage);
        }
        return this.taskResult;
    }
}
