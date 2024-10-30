import { Browser, ElementHandle, Locator, Page, TimeoutError } from 'puppeteer';

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
async function setPageViewPort(page: Page) {
    return page.setViewport({
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        isMobile: false,
    });
}
const debugLog = (msg: string) => console.log('\x1b[34m', msg, '\x1b[0m'); // blue log
const infoLog = (msg: string) => console.log('\x1b[32m', msg, '\x1b[0m'); // green log
const sleep = (delay: number) =>
    new Promise((resolve) => setTimeout(resolve, delay));
export class KauflandBot implements IBot {
    task!: IKauflandRankingTask;
    mainPage!: Page;
    browser!: Browser;
    taskResult!: IKauflandRankingTaskResult;
    getBaseUrl() {
        // Main Step3: Country Assertion: Verify the correct country (e.g., kaufland.de, kaufland.nl).
        return `https://www.kaufland.${this.task.location}`;
    }
    async newBasePage() {
        const page = await this.browser.newPage();
        // page.on('console', (msg) => console.log('PAGE LOG:', msg.text())); // TEST: To see page log
        await page?.goto(this.getBaseUrl());
        await setPageViewPort(page);
        return page;
    }
    hideCookieAlertIfItAppears() {
        const page = this.mainPage;
        // Click Cookie Accept Button if the alert is displayed
        page.locator('#onetrust-accept-btn-handler')
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
            .catch((error) => {
                if (error instanceof TimeoutError)
                    infoLog('Cookie alert is not displayed');
                else console.error('Unknown error: ' + error);
            });
    }
    async checkProfile() {
        const page = this.mainPage;
        // Main Step2: Profile Check
        const accountLogin: ElementHandle = await Promise.race([
            page.locator('.rd-aw-login-entry>button').waitHandle(),
            page.locator('.rd-aw-login-entry>a').waitHandle(),
            page.locator('.rd-aw-login-entry>span').waitHandle(),
        ]);
        const tagName = await accountLogin.evaluate((el) =>
            el.tagName.toLowerCase()
        );
        const isLoggedIn = tagName === 'button';
        if (this.task.isAnonymous) {
            if (isLoggedIn) {
                console.error(
                    'Profie Mismatch:  Anonymous user is expected but profile is logged in'
                );
            } else {
                infoLog('Anonymouse profile matched');
            }
        } else {
            if (!isLoggedIn) {
                console.error('profile Mismatch:  Profile should be logged in');
            } else {
                infoLog('Profile is logged in');
            }
        }
    }
    async getCartCount() {
        // Main Step4: Retrieve Cart Count: Count the products in the cart before starting.
        const cartPage = await this.browser.newPage();
        await setPageViewPort(cartPage);
        await cartPage.goto(`${this.getBaseUrl()}/checkout/cart`);
        const cartHandle: ElementHandle = await Promise.race([
            cartPage.locator('.empty-cart').waitHandle(),
            cartPage.locator('.filled-cart .article-counter').waitHandle(),
        ]);
        const cartClassName = await cartHandle.evaluate((el) => el.className);
        let cartCount = 0;
        if (cartClassName !== 'empty-cart') {
            const textContent = await cartHandle.evaluate(
                (el) => el.textContent
            );
            if (textContent === null) {
                console.error('TextContent of cart article should not be null');
            } else {
                cartCount = Number(
                    textContent
                        .replace('(', '')
                        .replace(')', '')
                        .trim()
                        .split(' ')[0]
                );
            }
        }
        await cartPage.close();
        return cartCount;
    }
    async inputSearchFilters() {
        const page = this.mainPage;
        // Step5: Input Search Criteria: Enter the keyword and other search filter values.
        const { keyword, minPrice, maxPrice } =
            this.task.productAction.searchCriteria;
        const searchInputHandle = await page
            .locator('input.rh-search__input')
            .waitHandle();
        await searchInputHandle.type(keyword);
        await searchInputHandle.press('Enter');
        infoLog('search input is filled and entered');

        await page.waitForFunction(
            () =>
                document.querySelectorAll(
                    '.range-filter__input input.rd-input__input'
                ).length === 2
        );

        if (minPrice !== undefined || maxPrice !== undefined) {
            const elements = await page.$$(
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
        const inputedSearchFilter = await page
            .locator('input.rh-search__input')
            .map((input: HTMLInputElement) => input.value)
            .wait();
        if (inputedSearchFilter === keyword)
            infoLog(`${keyword} is inputed to search filter`);
        else {
            console.error(
                `${keyword} is NOT inputed to search filter: ` +
                    inputedSearchFilter
            );
        }

        if (minPrice !== undefined) {
            const inputedMinValueFilter = await page
                .locator(
                    '.range-filter__input:nth-of-type(1) input.rd-input__input'
                )
                .map((input: HTMLInputElement) => input.value)
                .wait();
            if (minPrice === Number(inputedMinValueFilter)) {
                infoLog(`${minPrice} is inputed to search filter`);
            } else {
                console.error(
                    `${minPrice} is NOT inputed to search filter: ` +
                        inputedMinValueFilter
                );
            }
        }

        if (maxPrice !== undefined) {
            const inputedMaxValueFilter = await page
                .locator(
                    '.range-filter__input:nth-of-type(2) input.rd-input__input'
                )
                .map((input: HTMLInputElement) => input.value)
                .wait();
            if (maxPrice === Number(inputedMaxValueFilter)) {
                infoLog(`${maxPrice} is inputed to search filter`);
            } else {
                console.error(
                    `${maxPrice} is NOT inputed to search filter: ` +
                        inputedMaxValueFilter
                );
            }
        }

        const searchedHandle = await Locator.race([
            page
                .locator('.product-count.result-header__product-count')
                .filter((el) => el.textContent?.trim() !== ''),
            page.locator('.empty-search__notification'),
        ]).waitHandle();

        if (
            await searchInputHandle.evaluate((el) =>
                el.classList.contains('empty-search__notification')
            )
        ) {
            console.error('Any matching search results');
            this.taskResult.totalResultItems = 0;
            this.taskResult.totalResultPages = 0;
        } else {
            this.taskResult.totalResultItems = Number(
                (await searchedHandle.evaluate((el) => el.textContent))
                    ?.replace('.', '')
                    .replace('+', '')
                    .trim()
                    .split(' ')[0]
            );

            if (this.taskResult.totalResultItems >= 40) {
                await page.waitForFunction(() => {
                    return (
                        document.querySelectorAll('.rd-page--static').length ===
                        2
                    );
                });
                const pages = await page.$$('.rd-page--page');
                this.taskResult.totalResultPages = Number(
                    (
                        await pages[pages.length - 1].evaluate(
                            (el) => el.textContent
                        )
                    )?.trim()
                );
            } else {
                this.taskResult.totalResultPages = 1;
            }
        }
    }
    async nextOrPrevPage(toNext: boolean = true) {
        const currentPage = await this.getCurrentPage();
        const page = this.mainPage;
        await page.waitForFunction(
            () =>
                document.querySelectorAll('button.rd-page--static').length === 2
        );
        if (toNext) {
            await page.locator('button.rd-page--static:last-child').click();
        } else {
            await page.locator('button.rd-page--static:first-child').click();
        }
        const targetPage = currentPage + (toNext ? 1 : -1);
        await page.waitForFunction(
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
    async getCurrentPage() {
        const page = this.mainPage;
        return Number(
            (
                await page
                    .locator('span.rd-page--current')
                    .map((el) => el.textContent)
                    .wait()
            )?.trim()
        );
    }
    async exploreSERP() {
        const page = this.mainPage;
        const { task } = this;
        if (this.taskResult.totalResultPages) {
            let currentPage = 1;
            while (
                currentPage < this.taskResult.totalResultPages &&
                currentPage <
                    task.productAction.searchCriteria.numberPagesToSearch
            ) {
                const currentPageSpanValue = await this.getCurrentPage();
                if (currentPageSpanValue !== currentPage) {
                    console.error(
                        `current page is incorrect=> ${currentPage} expected but ${currentPageSpanValue}. Will navigate to the target page`
                    );
                    this.nextOrPrevPage(currentPageSpanValue < currentPage);
                    continue;
                }
                await page.waitForFunction(
                    () =>
                        document.querySelectorAll('article.product').length > 0
                );
                const allProducts = await page.$$('article.product');
                debugLog(`kk-346 allProducts: ${allProducts.length}`);
                // Explore random products
                let randomProductsToVisit: IProductAction[] = [];
                if (
                    currentPage <
                    task.productAction.randomProductVisitsPerPage.length
                )
                    randomProductsToVisit =
                        task.productAction.randomProductVisitsPerPage[
                            currentPage
                        ];
                let randomProductIndex = 0;

                for (
                    let productIndex = 0;
                    productIndex < allProducts.length;
                    productIndex++
                ) {
                    const product = allProducts[productIndex];
                    // TODO: if this product is main product?
                    await product.hover();
                    await sleep(300);
                    const productUrl = (
                        await (
                            await product.waitForSelector('a')
                        )?.evaluate((el) => {
                            return el.getAttribute('href');
                        })
                    )?.trim();
                    const splitedProductUrl: string[] =
                        productUrl?.split('/') || [];
                    if (
                        splitedProductUrl?.length < 3 ||
                        splitedProductUrl[0] !== '' ||
                        splitedProductUrl[1] !== 'product'
                    ) {
                        console.error(
                            `Invalid product url: ${splitedProductUrl} - ${productUrl} - ${productIndex}-index item on ${currentPage}-index page`
                        );
                    } else {
                        const productId = splitedProductUrl[2];
                        const isAdvertisedProduct =
                            (await product.$(
                                'aside.product-badge-container'
                            )) !== null;
                        isAdvertisedProduct &&
                            debugLog(
                                `kk-414 advertised product: ${productIndex}-index item on ${currentPage}-index page`
                            );
                        const isMainProduct =
                            task.productAction.productId === productId ||
                            task.productAction.variationIds?.includes(
                                productId
                            );
                        if (isAdvertisedProduct) {
                            if (isMainProduct) {
                                this.taskResult.isFoundAdvertised = true;
                            }
                            continue;
                        }
                        if (isMainProduct) {
                            debugLog(`kk-427 mainProductIndex:${productIndex}`);
                            this.taskResult.foundOnPage = currentPage;
                            this.taskResult.foundId = productId;
                            this.taskResult.isFoundVariationId =
                                task.productAction.productId !== productId;
                            this.taskResult.foundBySearch = true;
                            /* this.visitProductAndDoHumanActivity(
                                product,
                                this.task.productAction
                            ); */
                        }

                        /* if (
                            Math.random() <
                            (randomProductsToVisit.length -
                                randomProductIndex) /
                                (allProducts.length - productIndex)
                        ) {
                            this.visitProductAndDoHumanActivity(
                                product,
                                randomProductsToVisit[randomProductIndex]
                            );
                            randomProductIndex++;
                        } */
                    }
                }
                currentPage = await this.nextOrPrevPage();
            }
        }
        /* if (!taskResult.isMainProductFound && task.getProductInfoonNotFound) {
            const url = ' http://kaufland.de/product/ ' + task.productId;
            const info = visitProductByUrl(url); // no human activity but only info
            taskResult.mainInfo = info;
        } */
    }
    /* async visitProductAndDoHumanActivity(
        product: ElementHandle,
        productAction: IProductAction
    ): IProductInfo {
        const taskResult = this.taskResult;
    } */
    async handle(context: IBotContext): Promise<IKauflandRankingTaskResult> {
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
        this.mainPage = await this.newBasePage();

        // Actions
        this.hideCookieAlertIfItAppears();
        await this.checkProfile();
        // this.taskResult.cart.itemsCountBefore = await this.getCartCount(); //TEST:
        infoLog('Cart Count:' + this.taskResult.cart.itemsCountBefore);
        await this.inputSearchFilters();
        await this.exploreSERP();
        return this.taskResult;
    }
}
