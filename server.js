require('dotenv').config()

const Express = require('express')
const mongoose = require('mongoose')
const bcrypt = require("bcrypt")
const crypto = require("crypto")
const Schema = mongoose.Schema
const cookieParser = require("cookie-parser")
const cors = require('cors')

mongoose.connect("mongodb+srv://trollermaner:" + process.env.KEY + "@cluster0.9pogjfp.mongodb.net/?retryWrites=true&w=majority")

const transactionSchema = new Schema({
    items: {type: Schema.Types.Mixed, required: true},
    date: {type: Date, required: true, default: new Date()},
    status: {type: String, required: true, default: "Processing"},
    address: {type: String, required: true},
    userId: {type: String, required: true}
})//orders with item_id, in db, save items with their proper id and then show on transaction schema, title of item and id

const itemSchema = new Schema({
    title: {type: String, required: true},
    price: {type: Number, required: true},
    stock: {type: Number, required: true},
    description: {type: String, required: true},
    image: {type: String, required: true},
    sellerId: {type: String, require: true},
    date: {type: Date, required: true}
})

const accountSchema = new Schema({
    email: {type: String, required: true},
    password: {type: String, required: true},
    address: {type: String},
    sessionId: {type: Schema.Types.Mixed, required: true} //becomes empty once session ends {session, age}
})

const Transaction = mongoose.model("Transaction", transactionSchema)
const Items = mongoose.model("Items", itemSchema)
const Accounts = mongoose.model("Accounts", accountSchema)

const app = Express()

app.use(Express.urlencoded({extended: false}))
app.use(cookieParser())
app.use(cors({origin: 'https://marketplace-frontened-lcmop1p43-trollermaner.vercel.app/'}))
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://marketplace-frontened-lcmop1p43-trollermaner.vercel.app/'); // Replace with your frontend domain
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

app.get("/", async (req, res) => {
    try{
        if (!req.cookies.sessionId || req.cookies.sessionId === "") return res.json({loggedIn: false})
        const sessionId = req.cookies.sessionId
        let account = await Accounts.findOne({sessionId: sessionId})

        if (account === null) return res.json({loggedIn: false})

        return res.json({loggedIn: true, email: account.email})
    }
    catch{
        return res.status(500).json({error: "An error has occured"})
    }
})

app.get("/list/transaction", async (req, res) => {
    try{
        const transactionList = await Transaction.find()
        res.send(transactionList)
    }
    catch (error) {
        res.send(error).status(500)
    }
})

app.get("/list/items", async (req, res) => {
    try{
        const itemList = await Items.find().limit(50).sort({date: -1})
        res.json(itemList)
    }
    catch(err){
        res.send(err).status(500)
    }
})

app.post("/login", async (req, res) => {
    try{
        if (!req.body.email) return res.status(500).json({error: "Missing email"})
        if (!req.body.password) return res.status(500).json({error: "Missing password"})
        const email = req.body.email
        //valid email
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
        if(!emailRegex.test(email)) return res.status(500).json({error: "Invalid email address"})

        let account = await Accounts.findOne({email: email})
        if (account === null) return res.status(500).json({error: "Incorrect Email or Password"})

        const plainTextPassword = req.body.password
        
        if (! await bcrypt.compare(plainTextPassword, account.password)) return res.status(500).json({error: "Incorrect Email or Password"})

        //new sessionId
        let sessionId = crypto.randomBytes(60).toString("hex")

        //check for session Id dups
        let sessionDuplicates = await Accounts.find({sessionId: sessionId})

        while (sessionDuplicates.length > 0) {
            sessionId = crypto.randomBytes(60).toString("hex")
            sessionDuplicates = await Accounts.find({sessionId: sessionId})
        }

        account.sessionId = sessionId

        const savedAccount = await account.save()
        console.log(savedAccount)
        res.cookie("sessionId", sessionId, {maxAge: 2592000 * 1000}).send({cookie: sessionId})
    }
    catch{
        return res.status(500).json({error: "An error has occured"})
    }
})

app.get("/logout", async (req, res) => {
    try{
        if(!req.cookies.sessionId || req.cookies.sessionId === "") return res.status(500).json({error: "Not logged in"})
        const sessionId = req.cookies.sessionId 
        let account = await Accounts.findOne({sessionId: sessionId})
        account.sessionId = ""
        let updatedAccount = await account.save()
        console.log(updatedAccount)
        res.json({message: "Successfuly logged out"})
    }
    catch{
        res.status(500).json({error: "An error has occured"})
    }
})

app.post("/new/order", async (req, res) => {
    try{
        if (!req.body.items) return res.status(500).json({error: "Missing items"})
        if (!req.body.amounts) return res.status(500).json({error: "Missing quantity"})
        if (!req.body.address) return res.status(500).json({error: "Missing address"})
        if (!req.cookies.sessionId || req.cookies.sessionId === "") return res.status(500).json({error: "Missing session Id"})
        
        let items = req.body.items.split(",")
        let amounts = req.body.amounts.split(",")
        let date = new Date()
        if (req.body.date) {
            try{
                date = new Date(req.body.date)
                if (date.toString() == "Invalid Date") return res.status(500).json({error: req.body.date + " is not a valid date"})
            }
            catch{
                res.status(500).json({error: req.body.date + " is not a valid date"})
            }
        }
        
        let address = req.body.address

        let userId
        await Accounts.findOne({sessionId: req.cookies.sessionId})
            .then((data) => userId = data.id)

        let itemCostObject = {}

        for (let i = 0; i < items.length; i++) { //check stock
            let itemList
            try{
                itemList = await Items.findById(items[i])
            }
            catch (err) {
                return res.status(500).json({error: "Item: " + items[i] + " does not exist"})
            }

            if ((!(Number.isInteger(parseFloat(amounts[i])))) || (parseInt(amounts[i]) <= 0)) return res.status(500).json({error: amounts[i] + " is not a valid amount"})
            let amount = parseInt(amounts[i])
            let stock = parseInt(itemList.stock)

            if (stock >= amount) {
                stock = stock - amount
                itemList.stock = stock
                try{
                    await itemList.save()
                    itemCostObject[items[i]] = amount
                }
                catch (err){
                    console.log(err)
                }
            }

            else if (stock > 0) {
                itemList.stock = 0
                try{
                    await itemList.save()
                    itemCostObject[items[i]] = stock
                }
                catch (err){
                    console.log(err)
                }
            }
        }
        if (Object.keys(itemCostObject).length === 0){
            return res.json({error: "No more stock available"})
        }

        let transaction = new Transaction({items: itemCostObject, date: date, address: address, userId: userId})
        
        try {
            const savedTransaction = await transaction.save()
            console.log("Transaction saved", savedTransaction)
            res.json(savedTransaction)
        }
        catch(err){
            console.log(itemCostObject)
            res.status(500).json({error: "poop"})
        }
    }
    catch{
        return res.status(500).json({error: "An error has occured"})
    }
})

app.post("/new/account", async (req, res) => {
    try{
        if (!req.body.email) return res.status(500).json({error: "Missing email"})
        if (!req.body.password) return res.status(500).json({error: "Missing password"})

        const email = req.body.email
        const plainTextPassword = String(req.body.password)

        //email account existence
        if ((await Accounts.find({email: email})).length > 0) return res.status(500).json({error: "This account already exists"})

        //valid email
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
        if(!emailRegex.test(email)) return res.status(500).json({error: "Invalid email address"})

        //hash password
        const hashedPassword = await bcrypt.hash(plainTextPassword, 10)
        
        //new sessionId
        let sessionId = crypto.randomBytes(60).toString("hex")

        //check for session Id dups
        let sessionDuplicates = await Accounts.find({sessionId: sessionId})

        while (sessionDuplicates.length > 0) {
            sessionId = crypto.randomBytes(60).toString("hex")
            sessionDuplicates = await Accounts.find({sessionId: sessionId})
        }

        let account = new Accounts({password: hashedPassword, sessionId: sessionId, email: email})
        const savedAccount = await account.save()
        console.log(savedAccount)
        res.cookie("sessionId", sessionId, {maxAge: 2592000 * 1000}).send({cookie: sessionId})
    }
    catch(err){
        res.status(500).json({error: "An error has occured"})
    }
})



app.post("/new/item", async (req, res) => {
    try{
        if (!req.body.title) return res.status(500).json({error: "Missing item title"})
        if (!req.body.price) return res.status(500).json({error: "Missing item price"})
        if (!req.body.stock) return res.status(500).json({error: "Missing item stock"})
        if (!req.body.image) return res.status(500).json({error: "Missing item image"})
        if (!req.body.description) return res.status(500).json({error: "Missing item description"})

        let title = req.body.title
        if (isNaN(req.body.price)) return res.status(500).json({error: req.body.price + " is not a valid price"})
        let price = req.body.price
        if (!Number.isInteger(parseFloat(req.body.stock))) return res.status(500).json({error: req.body.stock + " is not a valid number"})
        let stock = req.body.stock
        let image = req.body.image
        let description = req.body.description
        const date = new Date()
        console.log(req.cookies)
        let sellerId
        await Accounts.findOne({sessionId: req.cookies.sessionId})
            .then((data) => sellerId = data.id)

        let item = new Items({title: title, price: price, stock: stock, description: description, image: image, sellerId: sellerId, date: date})
        
        try{
            const savedItem = await item.save()
            console.log("Saved Item", savedItem)
            res.json(savedItem)
        }
        catch (err) {
            res.status(500).json({error: "poopie"})
        }
    }
    catch(err){
        console.log(err)
        res.status(500).json({error: "An error has occured"})
    }
})

app.post("/owner/item", async (req, res) => {
    try{
        if (!req.body.productId) return res.status(400).json({ error: "No product given" });
        if (!req.cookies.sessionId || req.cookies.sessionId === undefined) {
            return res.status(401).json({ error: "Not logged in" });
        }
    
        const sessionId = req.cookies.sessionId
    
        const account = await Accounts.findOne({sessionId: sessionId})
        const product = await Items.findById(req.body.productId)
    
        if (account === null) return res.status(404).json({error: "Not logged in"})
        if (product === null) return res.status(404).json({error: "Product does not exist"})

        if (account.id === product.sellerId){
            return res.send(true)
        }
        return res.send(false)
    }   
    catch{
        res.status(500).json({error:"an error has occured"})
    }
})

app.post("/update/item", async (req, res) => {
    try {
        if (!req.body.title && !req.body.price && !req.body.stock && !req.body.image && !req.body.description) {
            return res.status(400).json({ error: "No updates made" });
        }
        if (!req.body.productId) {
            return res.status(400).json({ error: "No product to be updated" });
        }
        if (!req.cookies.sessionId || req.cookies.sessionId === undefined) {
            return res.status(401).json({ error: "Not logged in" });
        }
    
        const sessionId = req.cookies.sessionId;
        const productId = req.body.productId;
    
        const product = await Items.findById(productId);
    
        if (product === null) {
            return res.status(404).json({ error: "This product does not exist" });
        }
    
        // validate account
        const account = await Accounts.findOne({ sessionId: sessionId });
    
        if (account === null) {
            return res.status(401).json({ error: "This account does not exist" });
        }
    
        console.log(account.id);
        console.log(product.sellerId);
    
        if (account.id === product.sellerId) {
            if (req.body.title) {
                product.title = req.body.title;
            }
            if (req.body.price) {
                product.price = req.body.price;
            }
            if (req.body.stock) {
                product.stock = req.body.stock;
            }
            if (req.body.image) {
                product.image = req.body.image;
            }
            if (req.body.description) {
                product.description = req.body.description;
            }
    
            console.log(product);
    
            const updatedProduct = await product.save();
    
            console.log(updatedProduct);
    
            return res.json({ message: "Product successfully updated" });
        } else {
            return res.status(401).json({ error: "You do not own this product" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
    
})

app.get("/list/listings", async (req, res) => {
    try{
        if (!req.cookies.sessionId) return res.status(500).json({error: "Not signed in"})
        const sessionId = req.cookies.sessionId
        
        await Accounts.findOne({sessionId: sessionId})
            .then(async account => {
                if (account === null) return res.status(500).json({error: "Not signed in"})
                const sellerId = account.id
                await Items.find({sellerId: sellerId}).sort({"date": -1})
                    .then(itemList => {
                        if (itemList.length === 0) return res.json([])
                        return res.json(itemList)
                    })
            })
    }
    catch(err){
        console.log(err)
        res.status(500).json({error: "An error has occured"})
    }
})

app.get("/item", async (req, res) => {
    try{
        const productId = req.query.productId
        await Items.findById(productId)
            .then((data) => {
                if (data === null) return res.status(500).json({error: "This product does not exist"})
                res.json(data)
            })
    }
    catch(err){
        console.log(err)
        res.status(500).json({error: "An error has occured"})
    }
})

app.get("/delete", async (req, res) => {
    try{
        await Transaction.deleteMany({})
        await Items.deleteMany({})
        await Accounts.deleteMany({})
        res.send("Successfully deleted the whole DB")
    }
    catch{
        res.status(500).send("poopie")
    }
})

app.get("/list/accounts", async (req, res) => {
    let accounts = await Accounts.find()
    res.send(accounts)
})

app.listen(4000, () => {
    console.log("Listening on port 4000")
})