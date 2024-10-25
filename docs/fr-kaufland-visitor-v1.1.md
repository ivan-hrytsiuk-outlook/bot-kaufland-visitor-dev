## Kaufland bot v1.0

### Stack requirements

* Puppeteer + Stealth Plugin.
* Typescript
* Must be implemented as js library (ESM/CJS)
* Winston for logging.

### Bot algorithm

The bot operates on a JSON object referred to as the **Task**, which contains all activity details. It returns a JSON object known as the **Task Result**, containing all information regarding its execution. All steps in the algorithm must reference the data in the Task, especially if it affects the algorithm’s flow.

#### Main Steps:

1. **Open Start Page**: Directly input the start page URL.
2. **Profile Check**:
	- If a logged-in profile is required, assert that the profile is logged in.
	- If an anonymous profile is required, assert that the profile is not logged in.
3. **Country Assertion**: Verify the correct country (e.g., kaufland.de, kaufland.nl).
4. **Retrieve Cart Count**: Count the products in the cart before starting.
5. **Input Search Criteria**: Enter the keyword and other search filter values.
6. **Validate Filters**: Assert that all filter data is correctly input and reflected in the result pages.
7. **Iterate SERPs**: Continue to the next search engine result page (SERP) while pages exist and are below the limit set in the Task.
8. **Visit Products**:
	- Randomly visit products and perform defined activities (refer to **ON_PRODUCTS_PAGE**).
	- Log any errors with random products, but do not stop execution.
	- Ignore "advertised" products.

9. **Main Product Search**:
	- Concurrently search for the main product using the provided ID or variations.
	- If found, visit the product page and perform the defined activities.
	- Ensure the main product is not an advertised item.
	- Assert page loading fully and prevent revisiting products.

10. **Not Found Handling**:
- If the main product was not found and the Task specifies `productInfoOnNotFound` as true, directly visit the product's URL to collect product information `IProductInfo` and return it in the Task Result.

11. **Retrieve Cart Count Again**: Count the products in the cart after completing the activities.


#### ON_PRODUCTS_PAGE:

1. Stay on page and do some human actions given amount of time. Actions are:
    - scroll description
    - scroll page
    - click images
    - click any links with additional data (stays on product's page but navigate different parts of it)
2. Collect <IProductInfo> about product
3. Click "add to cart" (optional, see task)
4. Assert that product really added to cart
5. Wait some time and close this page and continue with main algo


### Simplified pseudocode of main algo

	function visitRandomProducts(n) {
		const allProducts = getAllProductsOnPage()
		for (let n = 0; i < n; i++) {
			const info = visitProductAndDoHumanActivity()
			taskResult.mainInfo = info
			backToSerpPage()
		}
	}


	openMainPage();
	inputFilterToSearch();

	currentPage = 1
	while (currentPage < task.totalPages) {

		const allProducts = getAllProductsOnPage()

		for (const product of allProducts ) {
			visitRandomProducts() // some of required random products

			const isMainProduct = product.id === task.productId || task.variationIds.includes(product.id)
			if (isMainProduct) {
				const info = visitProductandDoHumanActivity()
				taskResult.mainInfo = info
				backToSerpPage()
			}

			visitRandomProducts() // last of required random products
	
		}
		clickNextPage()
	}

	if (!taskResult.isMainProductFound && task.getProductInfoonNotFound) {
		const url = ' http://kaufland.de/product/ ' + task.productId
		const info = visitProductByUrl(url) // no human activity but only info
		taskResult.mainInfo = info
	}

	return taskResult`

### Important hints and requirements:
**Below points are part of FR and have to be considered due development**

* **Advertised** products on SERP must be ignored and never visited/clicked! If main product is found as advertised on page it must be ignored. taskResult.isFoundAdvertised must be set to true. Algo should continue. Advertised product is product with label "Anzeige": https://prnt.sc/Uc-HgxZe9ep8
* **"At the same time bot searches main product"** means that bot tries to find and visits main product while it iterates result pages 
* **Main Product** or ***Target product** relates to a product that have ID equals to given in task.productId or any task.variationIds
* **Visit** means click real actually exists and visible on current browser's page link. **Directly** go to product's url page. All activities on target website must be done like a usual human does. if otherwise is not mentioned.  
* Final version will operate over proxy with different fingerprints. When developing check with slow connection and few different user-agents and resolutions at least
* Add reasonable human-like delays between actions. Add some randomness to delays, do not use constant delay everywhere. 
* Extract important bot options and pass them as arguments for bot instance constructor. Eg. default timeout settings, default delay range
* No global variables. Multiple instances of the bot must be run simultaneously in one script without interfering.
* So any code that you need for development purposes like usage some proxy, stealth plugin, use api task and task result json should be only in test and dev scripts. Library itself must be easily used without that code.
* Implementation of basic puppeteer logic is easy. Main complexity is make bot stable and with high success rate +80%. That should be critical moment due development. **Always remember proxy can be slow. Do tests with slow connection**
* Support two types of thrown error objects Recoverable and Unrecoverable. Unrecoverable error should end any execution and return Task result with error.
* **Rate of "False success" must be zero**. We have to be sure if we get success all important activity were done properly. It is better to have "False error result" instead. **Use assertions** as much as possible to make sure every step of algo and to avoid accidental correct bot work.
* Use assertions as much as possible and do not hide or skip any errors. eg. always make sure:
	* you are on right page
	* important part of page is really loaded correctly
	* there is really no more pages to iterate
	* product was really added to cart
	* etc..
* **Use less hard-coded TIMEOUT/SLEEP** to wait page is loaded. Use waiting for some elements on page.
* **Do not use FULL_PAGE LOADING** if it is not necessary. Use waiting for ready state "interactive" or "complete". With slow connection full page loading may never happen.
* Good Testability: possibility separately test parts of main functionality including but not limited to:
	* find product by given search on SERP
	* scrape product information from product's page
	* get profile's cart info
	* test each action on product's page
* Implement retries in weak places:
    * input filter
    * next result page load
    * add to cart
    * add to list
    * etc...
* Asks for proxies for development.
* Login and registration functionality do not need to be implemented. If "logged in" account is used it will be logged because of cookies and before open start page. 
* note that out of scope of this task:
	* integration with api to get next task and return result.
	* any fingerprinting and cookies management
	* any proxy related code. Final version will operate over proxy.
	* registration or login into accounts.
* **Specific errors** bot has to return:
  * "Product not available" - if product does not exist at all.
  * "Product not found" - product exists in shop, but was not found in results with given filter
* Here it is example of product with **variations**: https://www.kaufland.de/product/359272830. https://prnt.sc/4Ah4FqW_dzlq

-----------------------
### API

 Below first prototype of API interface for the bot. It is subject of minor changes. And final interfaces will be provided as separate library to import.

```typescript

import {Browser} from "puppeteer";

interface IProductInfo {
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

interface IProductActionsResult {
	foundOnPage?: number;
	productId: string; // product id
	addToCart?: { before: boolean; after: boolean }; // was this product in cart before this run and after
	error?: string; // text of error that  happened while do actions on this product
	timeOnPage?: number; // seconds that bot spent on main products page: from moment it was  actually loaded
}

interface IProductAction {
	addToCart: boolean; // should product be added to cart
	minTimeOnPage: number; // what min time in seconds bot should stay on product's page doing various activity
}

interface IKauflandRankingTask {
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

interface IKauflandRankingTaskResult {
	totalResultPages?: number; // how many total pages in serp
	totalResultItems?: number; // how many total items in result reported by kaufland
	foundOnPage?: number; // on which page main product or its variation was found
	foundId?: string; // ID of main product or its variation that was found
	isFoundVariationId: boolean; // true if  ID of main product was found. false if variation ID was found.
	foundBySearch: boolean; // true if main product or its variation was found with normal search
	isFoundAdvertised: boolean /// if main product was found as advertised on any page.

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

interface IBotContext {
    browser: Browser,
    task: IKauflandRankingTask
}
export interface IBot {
    handle(context: IBotContext): Promise<IKauflandRankingTaskResult>;
}
```

### Example

```typescript
const task: IKauflandRankingTask = {
    "isAnonymous": false,
    "profile": {
        "name": "Tester",
        "password": "tester_password",
        "email": "tester@tester.com",
    },
    "location": "de",
    "productAction": {
        "searchCriteria": {
            "keyword": "flying spinner ball",
            "minPrice": 26,
            "maxPrice": 30,
            "numberPagesToSearch": 10
        },

        "productId": "B0BH89ML91",
        "addToCart": true,
        "minTimeOnPage": 15,
        "productInfoOnNotFound": true,
        "randomProductVisitsPerPage": [
            [// two random products on first page
                {
                    "addToCart": true,
                    "minTimeOnPage": 15,
                },
                {
                    "addToCart": false,
                    "minTimeOnPage": 15,
                }
            ],
            [],// no random product on second page
            [ // 1 random product on third page
                {
                    "addToCart": false,
                    "minTimeOnPage": 15,
                }
            ]
        ]
    }
}


const result: IKauflandRankingTaskResult = {
    totalResultPages: 100,
    totalResultItems: 10000,
    foundOnPage: 2,
    foundId: "1005003133674657",
    isFoundVariationId: false,
    foundBySearch: true,
	isFoundAdvertised: false,
    
    "cart": {
        "itemsCountBefore": 4,
        "itemsCountAfter": 5,
    },
    "productInfo": {
        "shopName": "The Funny Toy Store",
        "shopUrl": "https://www.kaufland.de/product/359272830/",
		"variations": [
			{id: "12312312"},
			{id: "12312423"},
			{id: "123124245343"},
		],
        "shopId": "912260780",
        "productId": "359272830",
        "price": 28.01,
        "productUrl": "https://www.kaufland.de/product/359272830/",
        "title": "Projob 6012 DAMEN T-SHIRT EN ISO 20471 KLASSE 2"
    },
    "mainProductPageActions": {
        "timeOnPage": 30,
        "productId": "1005003133674657",
        "addToCart": {"before": false, "after": true},
    },
    "otherProducts": [
        {
            "timeOnPage": 31,
            "foundOnPage": 1,
            "productId": "10000000000000001",
            "addToCart": {"before": false, "after": true},
        },
        {
            "timeOnPage": 16,
            "foundOnPage": 1,
            "productId": "10000000000000002",
            "error": "Something happened"
        },
        {
            "timeOnPage": 27,
            "foundOnPage": 3,
            "productId": "10000000000000003",
            "addToCart": {"before": false, "after": false},
        }
    ]
}
```