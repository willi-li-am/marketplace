require('dotenv').config()

const Express = require('express')
const mongoose = require('mongoose')
const bcrypt = require("bcrypt")
const crypto = require("crypto")
const Schema = mongoose.Schema
const cookieParser = require("cookie-parser")

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
    sellerId: {type: [String], require: true}
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

app.get("/", async (req, res) => {
    try{
        if (!req.cookies.sessionId) return res.json({loggedIn: false})
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
        res.cookie("sessionId", sessionId, {maxAge: 2592000 * 1000}).send("Logged In")
    }
    catch{
        return res.status(500).json({error: "An error has occured"})
    }
})

app.post("/new/order", async (req, res) => {
    try{
        if (!req.body.items) return res.status(500).json({error: "Missing items"})
        if (!req.body.amounts) return res.status(500).json({error: "Missing quantity"})
        if (!req.body.address) return res.status(500).json({error: "Missing address"})
        if (!req.cookies.sessionId) return res.status(500).json({error: "Missing session Id"})
        
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
        res.cookie("sessionId", sessionId, {maxAge: 2592000 * 1000}).send("account successfully created")
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
        
        let sellerId
        await Accounts.findOne({sessionId: req.cookies.sessionId})
            .then((data) => sellerId = data.id)

        let item = new Items({title: title, price: price, stock: stock, description: description, image: image, sellerId: sellerId})
        
        try{
            const savedItem = await item.save()
            console.log("Saved Item", savedItem)
            res.json(savedItem)
        }
        catch (err) {
            res.status(500).json({error: "poopie"})
        }
    }
    catch{
        res.status(500).json({error: "An error has occured"})
    }
})

app.get("/list/items", async (req, res) => {
    try{
        let searchTerm = ""
        if (req.query.search) {
            searchTerm = req.query.search
        }
        const itemList = await Items.find({ title: { $regex: searchTerm, $options: 'i' }})
        res.send(itemList)
    }
    catch{
        return res.status(500).json({error: "No items available"})
    }
})

app.get("/delete", async (req, res) => {
    try{
        await Transaction.deleteMany({})
        await Accounts.deleteMany({})
        await Items.deleteMany({})
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