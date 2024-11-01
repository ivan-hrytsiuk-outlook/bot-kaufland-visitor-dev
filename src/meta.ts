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
        .catch((error) => {
            if (error instanceof TimeoutError)
                infoLog('Cookie alert is not displayed');
            else console.error('Unknown error: ' + error);
        });
}

const debugLog = (...args: any[]) =>
    console.log('\x1b[34m', ...args, '\x1b[0m'); // blue log

const infoLog = (...args: any[]) =>
    console.info('\x1b[32m', ...args, '\x1b[0m'); // green log

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

    async getCartStatus(): Promise<CartStatus> {
        // Main Step4: Retrieve Cart Count: Count the products in the cart before starting.
        const cartPage = await this.browser.newPage();
        await setPageViewPort(cartPage);
        await cartPage.goto(`${this.getBaseUrl()}/checkout/cart`);
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
                console.error('TextContent of cart article should not be null');
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
                        console.error(
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
        infoLog('search input is filled and entered');

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
            console.error(
                `${keyword} is NOT inputed to search filter: ` +
                    inputedSearchFilter
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
                console.error(
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
                console.error(
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
            console.error('Any matching search results');
            taskResult.totalResultItems = 0;
            taskResult.totalResultPages = 0;
        } else {
            taskResult.totalResultItems = Number(
                (await searchedHandle.evaluate((el) => el.textContent))
                    ?.replace('.', '')
                    .replace('+', '')
                    .trim()
                    .split(' ')[0]
            );

            if (taskResult.totalResultItems >= 40) {
                //TODO: 40 is the number of products on each page?
                await mainPage.waitForFunction(() => {
                    return (
                        document.querySelectorAll('.rd-page--static').length ===
                        2
                    );
                });
                const pages = await mainPage.$$('.rd-page--page');
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
        const elem = await productPage.locator(selector).waitHandle();
        await elem.hover();
        const boundingBox = await elem.boundingBox();
        if (boundingBox) {
            for (let i = 0; i < numberOfMovement; i++) {
                await productPage.mouse.move(
                    boundingBox.x + Math.random() * boundingBox.width,
                    boundingBox.y + Math.random() * boundingBox.height
                );
                await sleep(Math.floor(Math.random() * 200 + 200));
            }
        }
    }

    async getProductInfo(productPage: Page, productInfo: IProductInfo) {
        /* const productInfo: IProductInfo = {
            shopName: string;
    shopUrl: string;
    shopId: string;
    variations?: { id: string }[]; // list of variation product IDS found on product's page
    //TODO: shopId, shopUrl
        };
        return productInfo; */
        await waitSkeletonLoading(productPage);
        const title =
            (await productPage
                .locator('.rd-title')
                .map((el) => el.textContent)
                .wait()) || '';
        if (title === '') {
            console.error(
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
                    console.error(
                        `getProductInfo=> Invalid variant attribute: ${dataPW}`
                    );
                } else {
                    variations.push({ id: dataPW.replace('variant-', '') });
                }
            })
        );
        productInfo.variations = variations;
    }

    async doProductAction(
        productPage: Page,
        productAction: IProductAction,
        productActionResult: IProductActionsResult
    ) {
        try {
            await waitSkeletonLoading(productPage);
            const { addToCart, minTimeOnPage } = productAction;
            const startTime = performance.now();
            let currentTime;
            do {
                currentTime = performance.now();
                const RANDOM_ACTION_COUNT = 3;
                const randomAction = Math.floor(
                    Math.random() * RANDOM_ACTION_COUNT
                );
                debugLog(`Ln474=> randomAction:${randomAction} started`);
                switch (randomAction) {
                    case 0:
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            '.description-teaser__description-text',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    case 1:
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            'picture.product-picture',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    case 2:
                        await this.moveAroundElementBoxOnProductPage(
                            productPage,
                            '.rd-product-description__top-accordion-content-description',
                            Math.floor(Math.random() * 10 + 5)
                        );
                        break;
                    default:
                        console.error('Invalid random product page action');
                }
                debugLog(`Ln474=> randomAction:${randomAction} stopped`);
            } while (currentTime - startTime < minTimeOnPage * 1000);
            productActionResult.timeOnPage = Math.floor(
                (currentTime - startTime) / 1000
            );
            debugLog(
                `doProductAction:508=> allRandomActions Finished ${productActionResult.timeOnPage}s delayed`
            );

            if (addToCart) {
                await productPage.locator('.rd-add-to-cart__button').click();
                infoLog(
                    `${productActionResult.productId} cart button is clicked`
                );
                await productPage
                    .locator('.add-to-cart-overlay__close')
                    .click();
                infoLog(`${productActionResult.productId} is added to cart`);
            }
        } catch (error) {
            if (error instanceof Error) {
                console.error('doProductAction=>', error);
                productActionResult.error = error.toString();
            } else {
                console.error('doProductAction=> Unknown error:', error);
            }
        }
    }

    async exploreSERP(mainPage: Page) {
        const { task, taskResult } = this;
        if (taskResult.totalResultPages) {
            let currentPageNumber = 1;
            while (
                currentPageNumber < taskResult.totalResultPages &&
                currentPageNumber <
                    task.productAction.searchCriteria.numberPagesToSearch
            ) {
                const currentPageSpanValue = await this.getCurrentPageNumber(
                    mainPage
                );
                if (currentPageSpanValue !== currentPageNumber) {
                    console.error(
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
                debugLog(`Ln346 allProducts: ${allProducts.length}`);
                // Explore random products
                let randomProductActionsToVisit: IProductAction[] = [];
                if (
                    currentPageNumber <
                    task.productAction.randomProductVisitsPerPage.length
                )
                    randomProductActionsToVisit =
                        task.productAction.randomProductVisitsPerPage[
                            currentPageNumber
                        ];
                let randomProductIndex = 0;

                for (
                    let productIndex = 0;
                    productIndex < allProducts.length;
                    productIndex++
                ) {
                    const product = allProducts[productIndex];
                    await product.hover();
                    // await sleep(300); // TEST
                    const productATag = await product.waitForSelector('a');
                    const productUrl =
                        (
                            await productATag?.evaluate((el) => {
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
                        console.error(
                            `Invalid product url: ${splitedProductUrl} - ${productUrl} - ${productIndex}-index item on ${currentPageNumber}-index page`
                        );
                    } else {
                        const productId = splitedProductUrl[2];
                        const isAdvertisedProduct =
                            (await product.$(
                                'aside.product-badge-container'
                            )) !== null;
                        isAdvertisedProduct &&
                            debugLog(
                                `Ln414 advertised product: ${productIndex}-index item on ${currentPageNumber}-index page`
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
                            debugLog(`Ln427 mainProductIndex:${productIndex}`);
                            taskResult.mainProductPageActions.foundOnPage =
                                taskResult.foundOnPage = currentPageNumber;
                            taskResult.foundId = productId;
                            taskResult.isFoundVariationId =
                                task.productAction.productId !== productId;
                            taskResult.foundBySearch = true;
                            // page will be updated. TODO: I should discuss about it.
                            // //<--- Option1 - Click the product
                            // productATag?.click();
                            // const productPage = page; //TEST:
                            // //--->

                            // <--- Option2 - Open new Page
                            const productPage = await this.browser.newPage();
                            await setPageViewPort(productPage);
                            debugLog(
                                'Ln623=> main product pageUrl:',
                                this.getBaseUrl() + productUrl
                            );
                            await productPage.goto(
                                this.getBaseUrl() + productUrl
                            );
                            // --->
                            taskResult.mainProductPageActions.productId =
                                productId;
                            await this.doProductAction(
                                productPage,
                                task.productAction,
                                taskResult.mainProductPageActions
                            );
                            const productInfo: IProductInfo = {
                                productId,
                                productUrl,
                                shopName: '',
                                shopUrl: '',
                                shopId: '',
                                price: 0,
                                title: '',
                            };
                            await this.getProductInfo(productPage, productInfo);
                            taskResult.productInfo = productInfo;
                            // await productPage.goBack(); // Option1
                            await productPage.close(); // Option2
                        } else if (
                            Math.random() <
                            (randomProductActionsToVisit.length -
                                randomProductIndex) /
                                (allProducts.length - productIndex)
                        ) {
                            // // <--- Option1 - Click the product
                            // productATag?.click();
                            // const productPage = page;
                            // // --->

                            // <--- Option2 - Open new Page
                            const productPage = await this.browser.newPage();
                            await setPageViewPort(productPage);
                            await productPage.goto(
                                this.getBaseUrl() + productUrl
                            );
                            // --->
                            const productActionResult: IProductActionsResult = {
                                productId,
                                foundOnPage: currentPageNumber,
                            };
                            await this.doProductAction(
                                productPage,
                                randomProductActionsToVisit[randomProductIndex],
                                productActionResult
                            );
                            randomProductIndex++;
                            taskResult.otherProducts.push(productActionResult);
                            // await productPage.goBack(); // Option1
                            await productPage.close(); // Option2
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
            await setPageViewPort(productPage);
            await productPage.goto(productUrl);
            taskResult.productInfo = {
                productId,
                productUrl,
                shopName: '',
                shopUrl: '',
                shopId: '',
                price: 0,
                title: '',
            };
            await this.getProductInfo(productPage, taskResult.productInfo);
            productPage.close();
        }
    }

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
        /* const mainPage = await this.browser.newPage();
        await mainPage?.goto(this.getBaseUrl());
        await setPageViewPort(mainPage);

        // Actions
        hideCookieAlertIfItAppears(mainPage);
        await this.checkProfile(mainPage);

        const cartStatusBefore: CartStatus = await this.getCartStatus();
        infoLog('Cart Status:', cartStatusBefore);

        await this.inputSearchFilters(mainPage);
        await this.exploreSERP(mainPage);

        const cartStatusAfter: CartStatus = await this.getCartStatus();
        infoLog('Cart Status:', cartStatusAfter);

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
        await mainPage.close(); */

        // GetProductInfo Test
        const productId = '359272830';
        const productUrl = `${this.getBaseUrl()}/product/${productId}`;
        const productPage = await this.browser.newPage();
        productPage.setDefaultTimeout(5000);
        await setPageViewPort(productPage);
        await productPage.goto(productUrl);
        const productInfo: IProductInfo = {
            productId,
            productUrl,
            shopName: '',
            shopUrl: '',
            shopId: '',
            price: 0,
            title: '',
        };
        await this.doProductAction(
            productPage,
            {
                addToCart: true,
                minTimeOnPage: 5,
            },
            { productId }
        );
        infoLog(productInfo);
        await productPage.waitForNavigation();
        await productPage.close();

        return this.taskResult;
    }
}
