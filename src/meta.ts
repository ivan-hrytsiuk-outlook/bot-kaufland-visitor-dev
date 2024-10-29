import { Browser, ElementHandle, Page, TimeoutError } from 'puppeteer';

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
        page.on('console', (msg) => console.log('PAGE LOG:', msg.text())); // TEST: To see page log
        await page?.goto(this.getBaseUrl());
        await setPageViewPort(page);
        return page;
    }
    hideCookieAlertIfItAppears(page: Page = this.mainPage) {
        // Click Cookie Accept Button if the alert is displayed
        page.locator('#onetrust-accept-btn-handler')
            //.setTimeout(100)
            .waitHandle()
            .then(async (acceptBtn) => {
                if (!acceptBtn) {
                    throw new Error('Null accept Btn');
                }
                console.info('Cookie alert is shown', acceptBtn);
                await acceptBtn.click();
                console.info('Cookie Accept button is clicked', acceptBtn);
            })
            .catch((error) => {
                if (error instanceof TimeoutError)
                    console.info('Cookie alert is not displayed');
                else console.error('Unknown error: ' + error);
            });
    }
    async checkProfile(page: Page = this.mainPage) {
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
                console.info('Anonymouse profile matched');
            }
        } else {
            if (!isLoggedIn) {
                console.error('profile Mismatch:  Profile should be logged in');
            } else {
                console.info('Profile is logged in');
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
    async inputSearchFilters(page: Page = this.mainPage) {
        // Step5: Input Search Criteria: Enter the keyword and other search filter values.
        const { keyword, minPrice, maxPrice } =
            this.task.productAction.searchCriteria;
        const searchInputHandle = await page
            .locator('input.rh-search__input')
            .waitHandle();
        await searchInputHandle.type(keyword);
        await searchInputHandle.press('Enter');
        console.info('search input is filled and entered');

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
    }
    async validateInputFilers(page: Page = this.mainPage) {
        const { keyword, minPrice, maxPrice } =
            this.task.productAction.searchCriteria;
        // Step6. Validate Filters: Assert that all filter data is correctly input and reflected in the result pages.
        const inputedSearchFilter = await page
            .locator('input.rh-search__input')
            .map((input: HTMLInputElement) => input.value)
            .wait();
        if (inputedSearchFilter === keyword)
            console.info(`${keyword} is inputed to search filter`);
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
                console.info(`${minPrice} is inputed to search filter`);
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
                console.info(`${maxPrice} is inputed to search filter`);
            } else {
                console.error(
                    `${maxPrice} is NOT inputed to search filter: ` +
                        inputedMaxValueFilter
                );
            }
        }
    }
    async handle(context: IBotContext): Promise<IKauflandRankingTaskResult> {
        // Init Properties
        this.task = context.task;
        this.taskResult = {
            isFoundVariationId: false,
            foundBySearch: false,

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
        this.taskResult.cart.itemsCountBefore = await this.getCartCount();
        console.log('Cart Count:', this.taskResult.cart.itemsCountBefore);
        await this.inputSearchFilters();
        await this.validateInputFilers();

        // TEST: Wait Long Time
        await this.mainPage.waitForNavigation({
            timeout: 5 * 60 * 1000 /* 5 mins */,
        });
        return {} as any;
    }
}
