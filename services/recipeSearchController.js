'use strict';
var Recipe = require('../components/recipe/recipeSchema');
var RecipeFamily = require('../components/recipeFamily/recipeFamilySchema');
var IngredientList = require('../components/ingredientList/ingredientListSchema');
var Ingredient = require('../components/ingredient/ingredientSchema');
var Supermarket = require('../components/supermarket/supermarketSchema');


var async = require("async");

/*
 expected body structure:
 {
 searchtext: nonempty String, required
 useParameter: boolean, required
 vegetarian: boolean, default false
 vegan: boolean, default false
 effortLow
 effortMedium
 effortHigh
 }
 */
exports.searchRecipes = function (req, res) {

    if (!req.body.searchtext || req.body.searchtext == "") {
        res.status(400).send('Search text required.');
        return;
    }
    if (typeof req.body.userParameter === 'undefined') {
        res.status(400).send("Attribute 'userParameter' required");
        return;
    }

    var textquery = {
        '$text': {
            '$search': req.body.searchtext
        }
    };


    if (req.body.userParameter) {

        var query = Recipe.find({$text: {$search: req.body.searchtext}}, {score: {$meta: "textScore"}}).sort({score: {$meta: "textScore"}});

        //Filter for vegetarian and vegan flags
        if (typeof req.body.vegetarian !== 'undefined') {
            query.where("vegetarian", req.body.vegetarian);
        }
        if (typeof req.body.vegan !== 'undefined') {
            query.where("vegan", req.body.vegan);
        }

        //filter for effort
        var effortFilter = [];
        if (typeof req.body.effortLow !== 'undefined' && req.body.effortLow) {
            effortFilter.push({effort: 1});
        }
        if (typeof req.body.effortMedium !== 'undefined' && req.body.effortMedium) {
            effortFilter.push({effort: 2});
        }
        if (typeof req.body.effortHigh !== 'undefined' && req.body.effortHigh) {
            effortFilter.push({effort: 3});
        }
        if (effortFilter.length > 0) {
            query.or(effortFilter);
        }

        query.exec(function (queryError, queryResult) {
            if (queryError) {
                res.status(500).send(queryError);
                return;
            }
            ;

            //Calculate supermarket availabilities:
            async.forEach(queryResult, function (recipe, forEachCallback) {
                calculateAvailableSupermarkets(recipe, forEachCallback);
            }), function (forEachError) {
                res.status(500).send(forEachError);
                return;
            };

            res.json(queryResult);
        });


    } else {
        var query = RecipeFamily.find({'$text': {'$search': req.body.searchtext}});

        query.exec(function (queryError, queryResult) {
            if (queryError) {
                res.status(500).send(queryError);
                return;
            }
            ;

            res.json(queryResult);
        });

    }

};

function calculateAvailableSupermarkets(recipe, callback) {

    var ingredientList;
    var supermarkets;

    //load ingredientList of current recipe and supermarkets
    async.parallel(
        [
            function (loadCallback) {
                IngredientList.findById(recipe.ingredientList, function (err, result) {
                    if (err) {
                        loadCallback(err);
                    }
                    ingredientList = result;
                    loadCallback();
                })
            },
            function (loadCallback) {
                Supermarket.find(function (err, result) {
                    if (err) {
                        loadCallback(err);
                    }
                    supermarkets = result;
                    loadCallback();
                })
            }
        ]
    ), function (loadError) {
        if (loadError) {
            callback(loadError);
        }

        //load ingredients of current ingredientList
        async.map(ingredientList, function (ingredientId, loadIngredientCallback) {
            Ingredient.findById(ingredientId, function (err, ingredient) {
                if (err) {
                    loadIngredientCallback(err);
                }
                loadIngredientCallback(null, ingredient.supermarkets);
            }), function (mapError, supermarketLists) {
                if (mapError) {
                    callback(mapError);
                }

                async.reduce(supermarketLists, supermarkets, function (availabilityState, supermarketsOfIngredient, reduceCallback) {
                    if (availabilityState.length == 0) {
                        reduceCallback(null, []);
                    }


                    var newAvailabilityState = [];

                    for (s in availabilityState) {
                        if (supermarketsOfIngredient.indexOf(s) >= 0) {
                            newAvailabilityState.push(s);
                        }
                    }
                }, function (reduceError, reduction) {
                    if (reduceError) {
                        callback(reduceError);
                    }

                    recipe.availability = availableSupermarkets;
                    callback();
                });
            };
        });

    };
}
